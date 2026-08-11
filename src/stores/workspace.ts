import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { watch as watchFs, type UnwatchFn, type WatchEvent } from "@tauri-apps/plugin-fs";
import {
  basename,
  copyEntry,
  createEntry,
  deleteEntry,
  dirname,
  joinPath,
  listDir,
  normalizeAbsPath,
  pathExists,
  renameEntry,
  type DirEntryInfo,
} from "@/shared/fs";
import { validateMoveTarget } from "@/shared/importReferences";
import {
  clearRecentFolders as clearRecentFoldersStorage,
  loadRecentFolders,
  pushRecentFolder,
  removeRecentFolder as removeRecentFolderStorage,
} from "@/shared/path";
import { promptInput } from "@/shared/promptDialog";
import { searchFiles, type FileSearchHit } from "@/shared/searchApi";
import { useCompareStore } from "@/stores/compare";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
import { useSearchStore } from "@/stores/search";
import { useSessionsStore } from "@/stores/sessions";

const WATCH_IGNORE_NAMES = new Set([
  ".git",
  "node_modules",
  "target",
  ".mirocode",
  ".mirocode-index",
  ".DS_Store",
]);

/** 终端 / 外部 git 命令会改这些路径；需触发状态刷新，但不要刷新资源树 */
function isGitMetaPath(path: string): boolean {
  return /(?:^|[/\\])\.git(?:[/\\]|$)/.test(path);
}

export interface TreeNode extends DirEntryInfo {
  depth: number;
  expanded?: boolean;
  loaded?: boolean;
  children?: TreeNode[];
}

export interface MovePathResult {
  from: string;
  to: string;
  isDir: boolean;
}

/** Toast 操作按钮 */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Toast 通知条目 */
export interface ToastItem {
  id: number;
  message: string;
  /** 可选操作按钮（如「安装」）；带 action 的 toast 不自动消失 */
  action?: ToastAction;
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const rootPath = ref<string | null>(null);
  const rootName = ref("未打开文件夹");
  /** 通知队列：可同时堆叠多条，由 ToastHost 渲染 */
  const toasts = ref<ToastItem[]>([]);
  const filter = ref("");
  const selectedPath = ref<string | null>(null);
  const childrenMap = ref<Record<string, DirEntryInfo[]>>({});
  const expanded = ref<Set<string>>(new Set());
  const recentFolders = ref<string[]>(loadRecentFolders());
  const clipboard = ref<{ mode: "copy" | "cut"; path: string } | null>(null);
  const extraIgnores = ref<string[]>([]);
  /** 触发资源树滚动到目标节点 */
  const revealToken = ref(0);
  const revealTarget = ref<string | null>(null);
  /** 过滤框的全项目定位结果（补全仅已加载节点的不足） */
  const locateHits = ref<FileSearchHit[]>([]);
  const locateLoading = ref(false);
  const refreshing = ref(false);
  const watchActive = ref(false);

  let noticeSeq = 0;
  const noticeTimers = new Map<number, number>();
  let locateTimer: number | undefined;
  let unwatchFn: UnwatchFn | null = null;
  let refreshTimer: number | undefined;
  let gitRefreshTimer: number | undefined;
  const selfWriteUntil = new Map<string, number>();
  let pendingWatchPaths = new Set<string>();

  function showNotice(message: string, ms = 2400, action?: ToastAction) {
    const id = ++noticeSeq;
    toasts.value.push({ id, message, action });
    // 带 action 的 toast 默认不自动消失（ms=0），等用户点击操作或手动关闭
    if (ms > 0) {
      const timer = window.setTimeout(() => {
        toasts.value = toasts.value.filter((x) => x.id !== id);
        noticeTimers.delete(id);
      }, ms);
      noticeTimers.set(id, timer);
    }
  }

  function dismissNotice(id: number) {
    const timer = noticeTimers.get(id);
    if (timer != null) window.clearTimeout(timer);
    noticeTimers.delete(id);
    toasts.value = toasts.value.filter((x) => x.id !== id);
  }

  /** 启动 LSP 语言服务（用户开启且运行时可用时） */
  async function startLsp(root: string) {
    const { useSettingsStore } = await import("@/stores/settings");
    const settings = useSettingsStore();
    if (!settings.editor.lspEnabled) return;
    const { lspManager } = await import("@/features/lsp/manager");
    void lspManager.start(root);
  }

  const flatTree = computed(() => {
    if (!rootPath.value) return [] as TreeNode[];
    const result: TreeNode[] = [];
    const q = filter.value.trim().toLowerCase();

    const walk = (path: string, depth: number) => {
      const kids = childrenMap.value[path] || [];
      for (const child of kids) {
        const match = !q || child.name.toLowerCase().includes(q);
        const isExpanded = expanded.value.has(child.path);
        if (child.isDir) {
          if (match || hasMatchingDescendant(child.path, q)) {
            result.push({
              ...child,
              depth,
              expanded: isExpanded,
              loaded: Boolean(childrenMap.value[child.path]),
            });
            if (isExpanded || q) {
              if (!childrenMap.value[child.path]) {
                // 过滤模式下懒加载已展开节点的子级由外部触发
              } else {
                walk(child.path, depth + 1);
              }
            }
          }
        } else if (match) {
          result.push({ ...child, depth });
        }
      }
    };

    walk(rootPath.value, 0);
    return result;
  });

  function hasMatchingDescendant(path: string, q: string): boolean {
    if (!q) return false;
    const kids = childrenMap.value[path] || [];
    for (const child of kids) {
      if (child.name.toLowerCase().includes(q)) return true;
      if (child.isDir && hasMatchingDescendant(child.path, q)) return true;
    }
    return false;
  }

  async function loadChildren(path: string) {
    if (!rootPath.value) return;
    const entries = await listDir(rootPath.value, path, extraIgnores.value);
    childrenMap.value = { ...childrenMap.value, [path]: entries };
  }

  function markSelfWrite(path: string, ms = 1600) {
    selfWriteUntil.set(path, Date.now() + ms);
  }

  function isSelfWrite(path: string) {
    const until = selfWriteUntil.get(path);
    if (!until) return false;
    if (Date.now() > until) {
      selfWriteUntil.delete(path);
      return false;
    }
    return true;
  }

  function shouldIgnoreWatchPath(path: string) {
    return path.split(/[/\\]/).some((part) => WATCH_IGNORE_NAMES.has(part));
  }

  function stopWatch() {
    unwatchFn?.();
    unwatchFn = null;
    watchActive.value = false;
    window.clearTimeout(refreshTimer);
    window.clearTimeout(gitRefreshTimer);
    pendingWatchPaths = new Set();
  }

  function scheduleGitRefresh() {
    window.clearTimeout(gitRefreshTimer);
    gitRefreshTimer = window.setTimeout(() => {
      void useGitStore().refresh();
    }, 420);
  }

  async function startWatch(root: string) {
    stopWatch();
    try {
      unwatchFn = await watchFs(
        root,
        (event) => {
          onWatchEvent(event);
        },
        { recursive: true, delayMs: 350 },
      );
      watchActive.value = true;
    } catch {
      watchActive.value = false;
      showNotice("无法自动监听文件变更，请使用刷新按钮", 3200);
    }
  }

  function onWatchEvent(event: WatchEvent) {
    if (!rootPath.value) return;
    let gitTouched = false;
    for (const p of event.paths || []) {
      if (isSelfWrite(p)) continue;
      // .git 变更：仅刷新 Git 状态（终端 commit/checkout 等）
      if (isGitMetaPath(p)) {
        gitTouched = true;
        continue;
      }
      if (shouldIgnoreWatchPath(p)) continue;
      pendingWatchPaths.add(p);
    }
    if (gitTouched) scheduleGitRefresh();
    if (!pendingWatchPaths.size) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      void flushWatchChanges();
    }, 200);
  }

  async function flushWatchChanges() {
    if (!rootPath.value || !pendingWatchPaths.size) return;
    const changed = [...pendingWatchPaths];
    pendingWatchPaths = new Set();
    // 工作区文件变了也会刷新 git；取消排队中的纯 git 刷新，避免重复
    window.clearTimeout(gitRefreshTimer);
    await refreshFromDisk(changed, { quiet: true });
  }

  async function refreshFromDisk(
    changedAbsPaths: string[] = [],
    options: { quiet?: boolean } = {},
  ) {
    if (!rootPath.value || refreshing.value) return;
    refreshing.value = true;
    try {
      // 仅重列受影响的父目录（文件变更局部刷新），避免大目录全量重列卡顿
      if (changedAbsPaths.length) {
        await refreshDirsForPaths(changedAbsPaths);
      } else {
        await refreshTree();
      }
      const root = rootPath.value;
      const { useEditorStore } = await import("@/stores/editor");
      const editor = useEditorStore();
      const openAbs = new Set(editor.tabs.map((t) => t.path));
      const touched = changedAbsPaths.filter(
        (p) => p.startsWith(root) && openAbs.has(p),
      );
      // 若未给出具体路径（手动刷新），同步全部打开标签
      if (!changedAbsPaths.length) {
        await editor.syncExternalChanges(editor.tabs.map((t) => t.path));
      } else if (touched.length) {
        await editor.syncExternalChanges(touched);
      }
      void useGitStore().refresh();
      if (!options.quiet) {
        showNotice("资源管理器已刷新");
      }
    } finally {
      refreshing.value = false;
    }
  }

  async function openFolder(
    path?: string | null,
    options?: { quiet?: boolean },
  ): Promise<boolean> {
    try {
      let selected = path;
      if (!selected) {
        selected = await open({
          directory: true,
          multiple: false,
          title: "打开文件夹",
        });
      }
      if (!selected || Array.isArray(selected)) return false;

      const previousRoot = rootPath.value;
      if (previousRoot !== selected) {
        const editor = useEditorStore();
        if (!editor.confirmDiscardForWorkspaceSwitch()) return false;
      }

      stopWatch();
      rootPath.value = selected;
      rootName.value = basename(selected);
      childrenMap.value = {};
      expanded.value = new Set([selected]);
      selectedPath.value = selected;
      filter.value = "";
      locateHits.value = [];
      clipboard.value = null;
      selfWriteUntil.clear();
      await loadChildren(selected);
      recentFolders.value = pushRecentFolder(selected);

      if (previousRoot !== selected) {
        useEditorStore().clearForWorkspaceSwitch();
        useCompareStore().clearAll();
        await useSessionsStore().resetLocalForWorkspace(selected);
        const { useSshStore } = await import("@/stores/ssh");
        await useSshStore().resetForWorkspace();
        const search = useSearchStore();
        search.clearResults();
        search.closeQuickOpen();
        search.closeFindInFiles();
        useGitStore().clearForWorkspaceSwitch();
        const { usePackageScriptsStore } = await import("@/stores/packageScripts");
        usePackageScriptsStore().clear();
        void usePackageScriptsStore().refresh(true);
      }

      if (!options?.quiet) {
        showNotice(`已打开 ${rootName.value}`);
      }
      void useGitStore().refresh();
      void startWatch(selected);
      // 启动 LSP 语言服务（用户开启且运行时可用时）
      void startLsp(selected);
      return true;
    } catch (error) {
      if (!options?.quiet) {
        showNotice(error instanceof Error ? error.message : String(error), 3200);
      }
      return false;
    }
  }

  /** 启动时恢复最近一次成功打开的工作区 */
  async function restoreLastFolder() {
    if (rootPath.value) return;
    for (const path of recentFolders.value) {
      try {
        const exists = await pathExists(path, path);
        if (!exists) continue;
      } catch {
        continue;
      }
      const ok = await openFolder(path, { quiet: true });
      if (ok) return;
    }
  }

  async function toggleExpand(path: string) {
    const next = new Set(expanded.value);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!childrenMap.value[path]) {
        await loadChildren(path);
      }
    }
    expanded.value = next;
  }

  async function refreshTree() {
    if (!rootPath.value) return;
    const root = rootPath.value;
    const paths = Object.keys(childrenMap.value);
    const nextMap: Record<string, DirEntryInfo[]> = {};
    await Promise.all(
      paths.map(async (p) => {
        try {
          if (p !== root && !(await pathExists(root, p))) return;
          nextMap[p] = await listDir(root, p, extraIgnores.value);
        } catch {
          // 目录已消失则丢弃缓存
        }
      }),
    );
    childrenMap.value = nextMap;
    const nextExpanded = new Set(
      [...expanded.value].filter((p) => p === root || Boolean(nextMap[p])),
    );
    nextExpanded.add(root);
    expanded.value = nextExpanded;
  }

  /**
   * 只重列受变更影响的父目录（文件变更局部刷新）。
   * 相比 refreshTree 的全量重列，大目录下显著降低保存/变更时的卡顿。
   */
  async function refreshDirsForPaths(changedAbsPaths: string[]) {
    const root = rootPath.value;
    if (!root) return;
    const dirs = new Set<string>();
    for (const p of changedAbsPaths) {
      if (!p.startsWith(root)) continue;
      // 变更本身是目录则刷新它，否则刷新其父目录
      const target = childrenMap.value[p] !== undefined ? p : dirname(p);
      if (target.startsWith(root) && childrenMap.value[target] !== undefined) {
        dirs.add(target);
      }
    }
    dirs.add(root);
    const nextMap = { ...childrenMap.value };
    await Promise.all(
      [...dirs].map(async (d) => {
        try {
          if (d !== root && !(await pathExists(root, d))) {
            delete nextMap[d];
            return;
          }
          nextMap[d] = await listDir(root, d, extraIgnores.value);
        } catch {
          delete nextMap[d];
        }
      }),
    );
    childrenMap.value = nextMap;
  }

  async function createIn(parent: string, isDir: boolean) {
    if (!rootPath.value) return;
    const label = isDir ? "新建文件夹" : "新建文件";
    const name = await promptInput({
      title: label,
      label: isDir ? "文件夹名称" : "文件名称",
      placeholder: isDir ? "components" : "index.ts",
      confirmText: "创建",
    });
    if (!name?.trim()) return;
    const target = joinPath(parent, name.trim());
    try {
      markSelfWrite(target);
      markSelfWrite(parent);
      await createEntry(rootPath.value, target, isDir);
      await loadChildren(parent);
      expanded.value = new Set([...expanded.value, parent]);
      selectedPath.value = target;
      showNotice(`${label}成功`);
      return target;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 3200);
    }
  }

  async function renamePath(path: string) {
    if (!rootPath.value) return;
    if (path === rootPath.value) {
      showNotice("不能重命名工作区根目录");
      return;
    }
    const nextName = await promptInput({
      title: "重命名",
      label: "新名称",
      defaultValue: basename(path),
      confirmText: "重命名",
    });
    if (!nextName?.trim() || nextName.trim() === basename(path)) return;
    const target = joinPath(dirname(path), nextName.trim());
    try {
      markSelfWrite(path);
      markSelfWrite(target);
      markSelfWrite(dirname(path));
      await renameEntry(rootPath.value, path, target);
      await refreshAffected(path, target);
      selectedPath.value = target;
      showNotice("已重命名");
      return { from: path, to: target };
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 3200);
    }
  }

  async function removePath(path: string) {
    if (!rootPath.value) return;
    if (path === rootPath.value) {
      showNotice("不能删除工作区根目录");
      return false;
    }
    const ok = await ask(`确定删除「${basename(path)}」？此操作不可撤销。`, {
      title: "确认删除",
      kind: "warning",
    });
    if (!ok) return false;
    try {
      markSelfWrite(path);
      markSelfWrite(dirname(path));
      await deleteEntry(rootPath.value, path);
      const parent = dirname(path);
      await loadChildren(parent);
      if (selectedPath.value === path) selectedPath.value = parent;
      showNotice("已删除");
      return true;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 3200);
      return false;
    }
  }

  function setClipboard(mode: "copy" | "cut", path: string) {
    clipboard.value = { mode, path };
    showNotice(mode === "copy" ? "已复制" : "已剪切");
  }

  async function pasteInto(parent: string) {
    if (!rootPath.value || !clipboard.value) return;
    const source = clipboard.value.path;
    const mode = clipboard.value.mode;
    const name = basename(source);
    let target = joinPath(parent, name);
    try {
      let n = 1;
      while (await pathExists(rootPath.value, target)) {
        const stem = name.includes(".")
          ? name.replace(/(\.[^.]+)?$/, `-copy${n}$1`)
          : `${name}-copy${n}`;
        target = joinPath(parent, stem);
        n += 1;
        if (n > 50) throw new Error("目标名称冲突过多");
      }

      markSelfWrite(source);
      markSelfWrite(target);
      markSelfWrite(parent);
      if (mode === "copy") {
        await copyEntry(rootPath.value, source, target);
      } else {
        await renameEntry(rootPath.value, source, target);
        clipboard.value = null;
      }
      await loadChildren(parent);
      await loadChildren(dirname(source));
      expanded.value = new Set([...expanded.value, parent]);
      selectedPath.value = target;
      showNotice("已粘贴");
      return { from: source, to: target, cut: mode === "cut" };
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 3200);
    }
  }

  async function refreshAffected(from: string, to?: string) {
    await loadChildren(dirname(from));
    if (to) await loadChildren(dirname(to));
  }

  /** 将文件/文件夹移动到目标目录下（保留 basename） */
  async function movePath(
    from: string,
    toParent: string,
    isDir: boolean,
  ): Promise<MovePathResult | null> {
    if (!rootPath.value) return null;
    const root = rootPath.value;
    const err = validateMoveTarget(from, toParent, root, isDir);
    if (err) {
      if (normalizeAbsPath(dirname(from)) !== normalizeAbsPath(toParent)) {
        showNotice(err, 3200);
      }
      return null;
    }
    const dest = joinPath(toParent, basename(from));
    if (await pathExists(root, dest)) {
      showNotice(`目标位置已存在「${basename(from)}」`, 3200);
      return null;
    }
    try {
      markSelfWrite(from);
      markSelfWrite(dest);
      markSelfWrite(toParent);
      markSelfWrite(dirname(from));
      await renameEntry(root, from, dest);
      await loadChildren(toParent);
      await loadChildren(dirname(from));
      expanded.value = new Set([...expanded.value, toParent]);
      selectedPath.value = dest;
      showNotice(`已移动 ${basename(from)}`);
      return { from, to: dest, isDir };
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 3200);
      return null;
    }
  }

  function selectPath(path: string | null) {
    selectedPath.value = path;
  }

  function pathPartsUnderRoot(path: string): string[] {
    if (!rootPath.value) return [];
    const root = rootPath.value.replace(/[/\\]+$/, "");
    if (!path.startsWith(root)) return [];
    const relative = path.slice(root.length).replace(/^[/\\]+/, "");
    return relative ? relative.split(/[/\\]/) : [];
  }

  async function revealPath(path: string) {
    if (!rootPath.value) return;
    const root = rootPath.value;
    const parts = pathPartsUnderRoot(path);
    if (!parts.length && path !== root) {
      showNotice("文件不在当前工作区内", 2800);
      return;
    }

    // 定位时清空过滤，避免目标被隐藏
    filter.value = "";
    locateHits.value = [];

    let cursor = root;
    if (!childrenMap.value[cursor]) {
      await loadChildren(cursor);
    }
    const next = new Set(expanded.value);
    next.add(root);
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor = joinPath(cursor, parts[i]);
      next.add(cursor);
      if (!childrenMap.value[cursor]) {
        await loadChildren(cursor);
      }
    }
    expanded.value = next;
    selectedPath.value = path;
    revealTarget.value = path;
    revealToken.value += 1;
  }

  async function runLocateSearch(query?: string) {
    if (!rootPath.value) return;
    const q = (query ?? filter.value).trim();
    if (q.length < 1) {
      locateHits.value = [];
      return;
    }
    locateLoading.value = true;
    try {
      locateHits.value = await searchFiles(rootPath.value, q, {
        maxResults: 40,
        extraIgnores: extraIgnores.value,
      });
    } catch {
      locateHits.value = [];
    } finally {
      locateLoading.value = false;
    }
  }

  function scheduleLocateSearch(query?: string) {
    window.clearTimeout(locateTimer);
    locateTimer = window.setTimeout(() => {
      void runLocateSearch(query);
    }, 220);
  }

  function setFilter(value: string) {
    filter.value = value;
    if (!value.trim()) {
      locateHits.value = [];
      return;
    }
    scheduleLocateSearch(value);
  }

  function clearFilter() {
    filter.value = "";
    locateHits.value = [];
  }

  function collapseAll() {
    if (!rootPath.value) return;
    expanded.value = new Set([rootPath.value]);
  }

  function removeRecentFolder(path: string) {
    recentFolders.value = removeRecentFolderStorage(path);
  }

  function clearRecentFolders() {
    recentFolders.value = clearRecentFoldersStorage();
  }

  return {
    rootPath,
    rootName,
    toasts,
    filter,
    selectedPath,
    childrenMap,
    expanded,
    recentFolders,
    clipboard,
    extraIgnores,
    flatTree,
    revealToken,
    revealTarget,
    locateHits,
    locateLoading,
    refreshing,
    watchActive,
    showNotice,
    dismissNotice,
    openFolder,
    restoreLastFolder,
    toggleExpand,
    refreshTree,
    refreshFromDisk,
    markSelfWrite,
    startWatch,
    stopWatch,
    createIn,
    renamePath,
    removePath,
    setClipboard,
    pasteInto,
    movePath,
    selectPath,
    revealPath,
    loadChildren,
    runLocateSearch,
    scheduleLocateSearch,
    setFilter,
    clearFilter,
    collapseAll,
    removeRecentFolder,
    clearRecentFolders,
  };
});
