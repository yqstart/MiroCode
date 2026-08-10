import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  basename,
  languageFromPath,
  pathExists,
  readTextFile,
  relativeToRoot,
  toAbsolutePath,
  writeTextFile,
} from "@/shared/fs";
import { isRasterImagePath } from "@/shared/media";
import {
  buildRemoteFileUri,
  isRemoteFilePath,
  parseRemoteFileUri,
  remoteTabLabel,
} from "@/shared/remoteFile";
import { sftpRead, sftpWrite } from "@/shared/sshApi";
import type { SshConnectConfig } from "@/shared/sshApi";
import { formatWithPrettier } from "@/shared/toolingApi";
import type { EditorFindRequest, EditorJumpTarget, EditorOpenAt } from "@/shared/types";
import { useCompareStore } from "@/stores/compare";
import { useGitStore } from "@/stores/git";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string;
  original: string;
  language: string;
  cursor: { line: number; column: number };
  /** 图片预览缓存破坏（外部变更时递增） */
  previewNonce: number;
  /** 固定标签：关闭其它/左/右/全部时保留 */
  pinned: boolean;
}

export const useEditorStore = defineStore("editor", () => {
  const tabs = ref<EditorTab[]>([]);
  const activePath = ref<string | null>(null);
  const jumpStack = ref<EditorJumpTarget[]>([]);
  const openAt = ref<EditorOpenAt | null>(null);
  let openAtSeq = 0;
  // 查找面板打开信号（原生菜单 ⌘F -> store -> 编辑器 watcher 消费）
  const findRequest = ref<EditorFindRequest | null>(null);
  let findRequestSeq = 0;

  /**
   * 外部修改标记：当 syncFromDisk / reloadAfterDiscard / formatDocument /
   * renameSymbol 等「非用户输入」来源改了 tab.content 时，先 markExternalUpdate(path)。
   * CodeMirrorEditor 的 props.content watcher 只有在 consumeExternalUpdate
   * 返回 true 时才把新内容 dispatch 进 CM；用户输入触发的 setContent 不标记，
   * watcher 直接 return，彻底切断 CM -> store -> prop -> CM 的回环。
   */
  const pendingExternalUpdates = new Set<string>();
  function markExternalUpdate(path: string): void {
    pendingExternalUpdates.add(path);
  }
  function consumeExternalUpdate(path: string): boolean {
    return pendingExternalUpdates.delete(path);
  }

  const activeTab = computed(
    () => tabs.value.find((t) => t.path === activePath.value) ?? null,
  );

  const dirtyPaths = computed(
    () =>
      new Set(
        tabs.value
          .filter((t) => !isRasterImagePath(t.path) && t.content !== t.original)
          .map((t) => t.path),
      ),
  );

  function isDirty(path: string) {
    return dirtyPaths.value.has(path);
  }

  function pushJump(target: EditorJumpTarget) {
    const last = jumpStack.value[jumpStack.value.length - 1];
    if (
      last &&
      last.path === target.path &&
      last.line === target.line &&
      last.column === target.column
    ) {
      return;
    }
    jumpStack.value.push(target);
    if (jumpStack.value.length > 50) {
      jumpStack.value.shift();
    }
  }

  function popJump(): EditorJumpTarget | null {
    return jumpStack.value.pop() ?? null;
  }

  function requestOpenAt(path: string, line: number, column: number) {
    openAtSeq += 1;
    openAt.value = { path, line, column, requestId: openAtSeq };
  }

  /** 请求打开当前活动编辑器的查找面板（原生菜单 ⌘F 触发） */
  function requestFind() {
    findRequestSeq += 1;
    findRequest.value = { path: activePath.value, requestId: findRequestSeq };
  }

  async function openRemoteFile(
    sftpSessionId: string,
    remotePath: string,
    meta: Pick<SshConnectConfig, "host" | "username" | "displayName">,
  ) {
    useSessionsStore().blurSessions();
    useCompareStore().blurCompare();
    void import("@/stores/gitLog").then(({ useGitLogStore }) => {
      useGitLogStore().blurLog();
    });

    const uri = buildRemoteFileUri(sftpSessionId, remotePath);
    const existing = tabs.value.find((t) => t.path === uri);
    if (existing) {
      activePath.value = uri;
      markExternalUpdate(uri);
      return;
    }

    const workspace = useWorkspaceStore();
    try {
      const content = await sftpRead(sftpSessionId, remotePath);
      tabs.value.push({
        id: uri,
        path: uri,
        name: remoteTabLabel(remotePath, meta),
        content,
        original: content,
        language: languageFromPath(remotePath),
        cursor: { line: 1, column: 1 },
        previewNonce: Date.now(),
        pinned: false,
      });
      activePath.value = uri;
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3600,
      );
    }
  }

  async function persistRemoteTab(tab: EditorTab, quiet = false) {
    const ref = parseRemoteFileUri(tab.path);
    if (!ref) return;
    const workspace = useWorkspaceStore();
    await sftpWrite(ref.sftpSessionId, ref.remotePath, tab.content);
    tab.original = tab.content;
    if (!quiet) {
      workspace.showNotice(`已保存到远程 ${basename(ref.remotePath)}`);
    }
  }

  async function openFile(path: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    useSessionsStore().blurSessions();
    useCompareStore().blurCompare();
    void import("@/stores/gitLog").then(({ useGitLogStore }) => {
      useGitLogStore().blurLog();
    });

    const existing = tabs.value.find((t) => t.path === path);
    if (existing) {
      activePath.value = path;
      // 切换到已打开 tab：标记外部修改，让 CodeMirrorEditor 的 content watcher
      // 正确同步该 tab 的内容（断环机制会阻断未标记的 dispatch）
      markExternalUpdate(path);
      workspace.selectPath(path);
      workspace.revealPath(path);
      return;
    }

    try {
      // 栅格图：不读文本，仅作预览标签
      const content = isRasterImagePath(path)
        ? ""
        : await readTextFile(workspace.rootPath, path);
      tabs.value.push({
        id: path,
        path,
        name: basename(path),
        content,
        original: content,
        language: languageFromPath(path),
        cursor: { line: 1, column: 1 },
        previewNonce: Date.now(),
        pinned: false,
      });
      activePath.value = path;
      workspace.selectPath(path);
      workspace.revealPath(path);
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function openFileAt(path: string, line: number, column: number) {
    const current = activeTab.value;
    if (current) {
      pushJump({
        path: current.path,
        line: current.cursor.line,
        column: current.cursor.column,
      });
    }
    await openFile(path);
    requestOpenAt(path, line, column);
  }

  function setContent(path: string, content: string) {
    const tab = tabs.value.find((t) => t.path === path);
    if (!tab) return;
    tab.content = content;
  }

  /** 磁盘内容已更新（如 import 批量替换），同步缓冲区且保持干净状态 */
  function syncFromDisk(path: string, content: string) {
    const tab = tabs.value.find((t) => t.path === path);
    if (!tab) return;
    markExternalUpdate(path);
    tab.content = content;
    tab.original = content;
  }

  /** 外部磁盘变更：干净标签自动重载；脏标签询问是否覆盖 */
  async function syncExternalChanges(changedPaths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !changedPaths.length) return;

    for (const path of changedPaths) {
      const tab = tabs.value.find((t) => t.path === path);
      if (!tab) continue;

      try {
        const exists = await pathExists(workspace.rootPath, path);
        if (!exists) {
          if (tab.content === tab.original) {
            await closeTab(path);
            workspace.showNotice(`「${tab.name}」已被外部删除`);
          } else {
            workspace.showNotice(
              `「${tab.name}」已被外部删除，本地仍有未保存更改`,
              3600,
            );
          }
          continue;
        }

        // 栅格图：刷新预览即可
        if (isRasterImagePath(path)) {
          tab.previewNonce = Date.now();
          workspace.showNotice(`「${tab.name}」已从磁盘重新加载`);
          continue;
        }

        const disk = await readTextFile(workspace.rootPath, path);
        if (disk === tab.content) {
          tab.original = disk;
          tab.previewNonce = Date.now();
          continue;
        }

        if (tab.content === tab.original) {
          markExternalUpdate(path);
          tab.content = disk;
          tab.original = disk;
          tab.previewNonce = Date.now();
          workspace.showNotice(`「${tab.name}」已从磁盘重新加载`);
          continue;
        }

        const overwrite = window.confirm(
          `「${tab.name}」已被外部修改，且本地有未保存更改。\n\n确定：用磁盘版本覆盖\n取消：保留编辑器内容`,
        );
        if (overwrite) {
          markExternalUpdate(path);
          tab.content = disk;
          tab.original = disk;
          tab.previewNonce = Date.now();
          workspace.showNotice(`「${tab.name}」已用磁盘版本覆盖`);
        } else {
          tab.original = disk;
          workspace.showNotice(`「${tab.name}」外部已变更，已保留本地编辑`, 3200);
        }
      } catch (error) {
        workspace.showNotice(
          error instanceof Error ? error.message : String(error),
          3200,
        );
      }
    }
  }

  /**
   * Git 回滚后强制同步编辑器：磁盘已还原/删除，缓冲区必须跟上，
   * 否则会出现「列表已干净、编辑器仍是旧内容」。
   */
  async function reloadAfterDiscard(repoRelativePaths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !repoRelativePaths.length) return;
    const root = workspace.rootPath;

    const absList = repoRelativePaths.map((p) => toAbsolutePath(root, p));
    const relSet = new Set(
      repoRelativePaths.map((p) => p.replace(/\\/g, "/")),
    );

    for (const abs of absList) {
      const tab = tabs.value.find((t) => t.path === abs);
      if (!tab) continue;
      try {
        const exists = await pathExists(root, abs);
        if (!exists) {
          await closeTab(abs);
          continue;
        }
        if (isRasterImagePath(abs)) {
          tab.previewNonce = Date.now();
          continue;
        }
        const disk = await readTextFile(root, abs);
        markExternalUpdate(abs);
        tab.content = disk;
        tab.original = disk;
        tab.previewNonce = Date.now();
      } catch (error) {
        workspace.showNotice(
          error instanceof Error ? error.message : String(error),
          3200,
        );
      }
    }

    const compare = useCompareStore();
    for (const tab of [...compare.tabs]) {
      const norm = tab.path.replace(/\\/g, "/");
      if (relSet.has(norm)) {
        compare.closeTab(tab.id);
      }
    }
  }

  function setCursor(path: string, line: number, column: number) {
    const tab = tabs.value.find((t) => t.path === path);
    if (!tab) return;
    tab.cursor = { line, column };
  }

  function activate(path: string) {
    useSessionsStore().blurSessions();
    useCompareStore().blurCompare();
    void import("@/stores/gitLog").then(({ useGitLogStore }) => {
      useGitLogStore().blurLog();
    });
    activePath.value = path;
    // 切换到已打开的 tab 时，CodeMirrorEditor 的 :key 不变（同一路径），
    // 组件不重建。props.content 会变成该 tab 的内容，但 watcher 的断环逻辑
    // 会阻断非外部修改的 dispatch。这里标记外部修改，让 watcher 正确同步内容。
    markExternalUpdate(path);
    const workspace = useWorkspaceStore();
    workspace.selectPath(path);
    workspace.revealPath(path);
  }

  /** 切到下一个标签；末尾循环到首个（VSCode 行为） */
  function activateNextTab() {
    if (tabs.value.length < 2) return;
    const idx = tabs.value.findIndex((t) => t.path === activePath.value);
    if (idx < 0) {
      activate(tabs.value[0].path);
      return;
    }
    const next = tabs.value[(idx + 1) % tabs.value.length];
    activate(next.path);
  }

  /** 切到上一个标签；首部循环到末个（VSCode 行为） */
  function activatePrevTab() {
    if (tabs.value.length < 2) return;
    const idx = tabs.value.findIndex((t) => t.path === activePath.value);
    if (idx < 0) {
      activate(tabs.value[0].path);
      return;
    }
    const prev = tabs.value[(idx - 1 + tabs.value.length) % tabs.value.length];
    activate(prev.path);
  }

  async function formatDocument(path?: string) {
    const workspace = useWorkspaceStore();
    const settings = useSettingsStore();
    if (!workspace.rootPath) return;
    if (!settings.editor.prettierEnabled) {
      workspace.showNotice("请先在设置中启用 Prettier");
      return;
    }
    const targetPath = path ?? activePath.value;
    if (!targetPath) {
      workspace.showNotice("当前无活动文件可格式化");
      return;
    }
    if (isRemoteFilePath(targetPath)) {
      workspace.showNotice("远程文件暂不支持格式化");
      return;
    }
    if (isRasterImagePath(targetPath)) return;

    let tab = tabs.value.find((t) => t.path === targetPath) ?? null;
    if (!tab) {
      await openFile(targetPath);
      tab = tabs.value.find((t) => t.path === targetPath) ?? null;
    }
    if (!tab) return;

    try {
      const rel = relativeToRoot(workspace.rootPath, tab.path);
      const formatted = await formatWithPrettier(
        workspace.rootPath,
        rel,
        tab.content,
      );
      if (formatted !== tab.content) {
        markExternalUpdate(tab.path);
        tab.content = formatted;
        workspace.showNotice(`已格式化 ${tab.name}`);
      } else {
        workspace.showNotice("无需格式化");
      }
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function saveActive(options?: { quiet?: boolean }) {
    const workspace = useWorkspaceStore();
    const git = useGitStore();
    if (!activeTab.value) {
      if (!options?.quiet) {
        workspace.showNotice("当前无活动文件可保存");
      }
      return;
    }
    const tab = activeTab.value;
    if (isRasterImagePath(tab.path)) return;

    if (isRemoteFilePath(tab.path)) {
      if (tab.content === tab.original) return;
      try {
        await persistRemoteTab(tab, options?.quiet);
      } catch (error) {
        if (!options?.quiet) {
          workspace.showNotice(
            error instanceof Error ? error.message : String(error),
            3200,
          );
        }
      }
      return;
    }

    if (!workspace.rootPath) {
      if (!options?.quiet) {
        workspace.showNotice("当前无活动文件可保存");
      }
      return;
    }

    let content = tab.content;
    if (content === tab.original) return;
    try {
      workspace.markSelfWrite(tab.path);
      await writeTextFile(workspace.rootPath, tab.path, content);
      tab.original = content;
      if (!options?.quiet) {
        workspace.showNotice(`已保存 ${tab.name}`);
      }
      void git.refresh();
    } catch (error) {
      if (!options?.quiet) {
        workspace.showNotice(
          error instanceof Error ? error.message : String(error),
          3200,
        );
      }
    }
  }

  async function saveAll(options?: { quiet?: boolean }) {
    const workspace = useWorkspaceStore();
    const git = useGitStore();
    const dirty = tabs.value.filter(
      (t) => !isRasterImagePath(t.path) && t.content !== t.original,
    );
    if (!dirty.length) return;
    try {
      let saved = 0;
      for (const tab of dirty) {
        if (isRemoteFilePath(tab.path)) {
          await persistRemoteTab(tab, true);
          saved += 1;
          continue;
        }
        if (!workspace.rootPath) continue;
        workspace.markSelfWrite(tab.path);
        await writeTextFile(workspace.rootPath, tab.path, tab.content);
        tab.original = tab.content;
        saved += 1;
      }
      if (!options?.quiet && saved > 0) {
        workspace.showNotice(
          saved === 1 ? `已保存 ${dirty[0].name}` : `已保存 ${saved} 个文件`,
        );
      }
      if (workspace.rootPath) void git.refresh();
    } catch (error) {
      if (!options?.quiet) {
        workspace.showNotice(
          error instanceof Error ? error.message : String(error),
          3200,
        );
      }
    }
  }

  async function closeTab(path: string) {
    const tab = tabs.value.find((t) => t.path === path);
    if (!tab) return;
    if (tab.content !== tab.original && !isRasterImagePath(tab.path)) {
      const ok = window.confirm(`「${tab.name}」有未保存更改，仍要关闭？`);
      if (!ok) return;
    }
    const idx = tabs.value.findIndex((t) => t.path === path);
    tabs.value = tabs.value.filter((t) => t.path !== path);
    if (activePath.value === path) {
      const next = tabs.value[idx] || tabs.value[idx - 1] || null;
      if (next) {
        activePath.value = next.path;
      } else {
        // 已无剩余文件标签：若终端标签已打开则兜底激活，避免「只剩终端却不激活」。
        // （closeTabsByPaths 批量关闭也会经由本函数，统一覆盖 closeAll/closeOthers 等场景）
        activePath.value = null;
        const sessions = useSessionsStore();
        if (sessions.open) sessions.focusSessions();
      }
    }
  }

  /** 断开 SFTP 会话时关闭对应远程编辑标签；force 时跳过未保存确认 */
  async function closeRemoteTabsForSftpSession(
    sftpSessionId: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    const victims = tabs.value.filter(
      (t) => parseRemoteFileUri(t.path)?.sftpSessionId === sftpSessionId,
    );
    if (!victims.length) return true;

    if (!options?.force) {
      const dirty = victims.filter(
        (t) => !isRasterImagePath(t.path) && t.content !== t.original,
      );
      if (dirty.length) {
        const ok = window.confirm(
          dirty.length === 1
            ? `远程文件「${dirty[0].name}」有未保存更改，断开连接将关闭该标签。继续？`
            : `${dirty.length} 个远程文件有未保存更改，断开连接将关闭这些标签。继续？`,
        );
        if (!ok) return false;
      }
    }

    const paths = new Set(victims.map((t) => t.path));
    tabs.value = tabs.value.filter((t) => !paths.has(t.path));
    if (activePath.value && paths.has(activePath.value)) {
      activePath.value = tabs.value[0]?.path ?? null;
    }
    return true;
  }

  /** 固定标签排到左侧，组内保持相对顺序 */
  function reorderPinnedFirst() {
    const pinned = tabs.value.filter((t) => t.pinned);
    const rest = tabs.value.filter((t) => !t.pinned);
    tabs.value = [...pinned, ...rest];
  }

  function togglePin(path: string) {
    const tab = tabs.value.find((t) => t.path === path);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    reorderPinnedFirst();
  }

  async function closeTabsByPaths(paths: string[]) {
    for (const path of paths) {
      await closeTab(path);
    }
  }

  async function closeOtherTabs(path: string) {
    const victims = tabs.value
      .filter((t) => t.path !== path && !t.pinned)
      .map((t) => t.path);
    await closeTabsByPaths(victims);
  }

  async function closeTabsToTheLeft(path: string) {
    const idx = tabs.value.findIndex((t) => t.path === path);
    if (idx <= 0) return;
    const victims = tabs.value
      .slice(0, idx)
      .filter((t) => !t.pinned)
      .map((t) => t.path);
    await closeTabsByPaths(victims);
  }

  async function closeTabsToTheRight(path: string) {
    const idx = tabs.value.findIndex((t) => t.path === path);
    if (idx < 0 || idx >= tabs.value.length - 1) return;
    const victims = tabs.value
      .slice(idx + 1)
      .filter((t) => !t.pinned)
      .map((t) => t.path);
    await closeTabsByPaths(victims);
  }

  async function closeAllTabs() {
    const victims = tabs.value.filter((t) => !t.pinned).map((t) => t.path);
    await closeTabsByPaths(victims);
  }

  function renameTabPath(from: string, to: string) {
    const tab = tabs.value.find((t) => t.path === from);
    if (!tab) return;
    tab.path = to;
    tab.id = to;
    tab.name = basename(to);
    tab.language = languageFromPath(to);
    tab.previewNonce = Date.now();
    if (activePath.value === from) activePath.value = to;
  }

  /** 文件夹移动后批量更新其下已打开标签路径 */
  function renameTabsUnderPrefix(fromPrefix: string, toPrefix: string) {
    const normFrom = fromPrefix.replace(/\\/g, "/").replace(/\/+$/, "");
    const normTo = toPrefix.replace(/\\/g, "/").replace(/\/+$/, "");
    for (const tab of [...tabs.value]) {
      const normPath = tab.path.replace(/\\/g, "/");
      if (normPath === normFrom) {
        renameTabPath(tab.path, toPrefix);
      } else if (normPath.startsWith(`${normFrom}/`)) {
        const suffix = normPath.slice(normFrom.length);
        renameTabPath(tab.path, `${normTo}${suffix}`);
      }
    }
  }

  function closeTabsUnder(prefix: string) {
    const victims = tabs.value.filter(
      (t) =>
        t.path === prefix ||
        t.path.startsWith(`${prefix}/`) ||
        t.path.startsWith(`${prefix}\\`),
    );
    for (const tab of victims) {
      tabs.value = tabs.value.filter((t) => t.path !== tab.path);
    }
    if (activePath.value && victims.some((t) => t.path === activePath.value)) {
      activePath.value = tabs.value[0]?.path ?? null;
    }
  }

  /** 切换工作区前：有未保存更改则确认是否丢弃 */
  function confirmDiscardForWorkspaceSwitch(): boolean {
    const dirty = tabs.value.filter(
      (t) => !isRasterImagePath(t.path) && t.content !== t.original,
    );
    if (!dirty.length) return true;
    return window.confirm(
      `${dirty.length} 个文件有未保存更改，切换项目将丢弃这些更改。继续？`,
    );
  }

  /** 切换工作区后清空文件标签与跳转栈 */
  function clearForWorkspaceSwitch() {
    tabs.value = [];
    activePath.value = null;
    jumpStack.value = [];
    openAt.value = null;
  }

  return {
    tabs,
    activePath,
    activeTab,
    dirtyPaths,
    jumpStack,
    openAt,
    findRequest,
    isDirty,
    pushJump,
    popJump,
    requestOpenAt,
    requestFind,
    openFile,
    openRemoteFile,
    openFileAt,
    setContent,
    syncFromDisk,
    markExternalUpdate,
    consumeExternalUpdate,
    syncExternalChanges,
    reloadAfterDiscard,
    setCursor,
    activate,
    activateNextTab,
    activatePrevTab,
    saveActive,
    saveAll,
    formatDocument,
    closeTab,
    closeRemoteTabsForSftpSession,
    togglePin,
    closeOtherTabs,
    closeTabsToTheLeft,
    closeTabsToTheRight,
    closeAllTabs,
    renameTabPath,
    renameTabsUnderPrefix,
    closeTabsUnder,
    confirmDiscardForWorkspaceSwitch,
    clearForWorkspaceSwitch,
  };
});
