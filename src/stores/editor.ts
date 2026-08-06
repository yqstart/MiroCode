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
import { formatWithPrettier } from "@/shared/toolingApi";
import type { EditorJumpTarget, EditorOpenAt } from "@/shared/types";
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
    const workspace = useWorkspaceStore();
    workspace.selectPath(path);
    workspace.revealPath(path);
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

  async function maybeFormatTab(
    root: string,
    tab: EditorTab,
  ): Promise<string> {
    const settings = useSettingsStore();
    if (!settings.editor.formatOnSave || !settings.editor.prettierEnabled) {
      return tab.content;
    }
    try {
      const rel = relativeToRoot(root, tab.path);
      const formatted = await formatWithPrettier(root, rel, tab.content);
      if (formatted !== tab.content) {
        tab.content = formatted;
      }
      return formatted;
    } catch {
      // 格式化失败不阻断保存
      return tab.content;
    }
  }

  async function saveActive(options?: { quiet?: boolean }) {
    const workspace = useWorkspaceStore();
    const git = useGitStore();
    const settings = useSettingsStore();
    if (!workspace.rootPath || !activeTab.value) {
      if (!options?.quiet) {
        workspace.showNotice("当前无活动文件可保存");
      }
      return;
    }
    const tab = activeTab.value;
    if (isRasterImagePath(tab.path)) return;

    let content = tab.content;
    const wantFormat =
      settings.editor.formatOnSave && settings.editor.prettierEnabled;
    if (wantFormat) {
      content = await maybeFormatTab(workspace.rootPath, tab);
    }
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
    const settings = useSettingsStore();
    if (!workspace.rootPath) return;
    const wantFormat =
      settings.editor.formatOnSave && settings.editor.prettierEnabled;
    // 先格式化，再筛脏文件
    if (wantFormat) {
      for (const tab of tabs.value) {
        if (isRasterImagePath(tab.path)) continue;
        await maybeFormatTab(workspace.rootPath, tab);
      }
    }
    const dirty = tabs.value.filter(
      (t) => !isRasterImagePath(t.path) && t.content !== t.original,
    );
    if (!dirty.length) return;
    try {
      for (const tab of dirty) {
        workspace.markSelfWrite(tab.path);
        await writeTextFile(workspace.rootPath, tab.path, tab.content);
        tab.original = tab.content;
      }
      if (!options?.quiet) {
        workspace.showNotice(
          dirty.length === 1 ? `已保存 ${dirty[0].name}` : `已保存 ${dirty.length} 个文件`,
        );
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
      activePath.value = next?.path ?? null;
    }
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
    isDirty,
    pushJump,
    popJump,
    requestOpenAt,
    openFile,
    openFileAt,
    setContent,
    syncFromDisk,
    syncExternalChanges,
    reloadAfterDiscard,
    setCursor,
    activate,
    saveActive,
    saveAll,
    formatDocument,
    closeTab,
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
