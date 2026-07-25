import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { ask, open } from "@tauri-apps/plugin-dialog";
import {
  basename,
  copyEntry,
  createEntry,
  deleteEntry,
  dirname,
  joinPath,
  listDir,
  pathExists,
  renameEntry,
  type DirEntryInfo,
} from "@/shared/fs";
import { loadRecentFolders, pushRecentFolder } from "@/shared/path";
import { useGitStore } from "@/stores/git";

export interface TreeNode extends DirEntryInfo {
  depth: number;
  expanded?: boolean;
  loaded?: boolean;
  children?: TreeNode[];
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const rootPath = ref<string | null>(null);
  const rootName = ref("未打开文件夹");
  const notice = ref("");
  const filter = ref("");
  const selectedPath = ref<string | null>(null);
  const childrenMap = ref<Record<string, DirEntryInfo[]>>({});
  const expanded = ref<Set<string>>(new Set());
  const recentFolders = ref<string[]>(loadRecentFolders());
  const clipboard = ref<{ mode: "copy" | "cut"; path: string } | null>(null);
  const extraIgnores = ref<string[]>([]);

  let noticeTimer: number | undefined;

  function showNotice(message: string, ms = 2400) {
    notice.value = message;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      notice.value = "";
    }, ms);
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

  async function openFolder(path?: string | null) {
    try {
      let selected = path;
      if (!selected) {
        selected = await open({
          directory: true,
          multiple: false,
          title: "打开文件夹",
        });
      }
      if (!selected || Array.isArray(selected)) return;

      rootPath.value = selected;
      rootName.value = basename(selected);
      childrenMap.value = {};
      expanded.value = new Set([selected]);
      selectedPath.value = selected;
      await loadChildren(selected);
      recentFolders.value = pushRecentFolder(selected);
      showNotice(`已打开 ${rootName.value}`);
      void useGitStore().refresh();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 3200);
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
    const paths = Object.keys(childrenMap.value);
    await Promise.all(paths.map((p) => loadChildren(p)));
  }

  async function createIn(parent: string, isDir: boolean) {
    if (!rootPath.value) return;
    const label = isDir ? "新建文件夹" : "新建文件";
    const name = window.prompt(label);
    if (!name?.trim()) return;
    const target = joinPath(parent, name.trim());
    try {
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
    const nextName = window.prompt("重命名", basename(path));
    if (!nextName?.trim() || nextName.trim() === basename(path)) return;
    const target = joinPath(dirname(path), nextName.trim());
    try {
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
    const ok = await ask(`确定删除「${basename(path)}」？此操作不可撤销。`, {
      title: "确认删除",
      kind: "warning",
    });
    if (!ok) return false;
    try {
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

  function selectPath(path: string | null) {
    selectedPath.value = path;
  }

  function revealPath(path: string) {
    if (!rootPath.value) return;
    const sep = rootPath.value.includes("\\") ? "\\" : "/";
    const relative = path.startsWith(rootPath.value)
      ? path.slice(rootPath.value.length).replace(/^[/\\]/, "")
      : "";
    const parts = relative ? relative.split(/[/\\]/) : [];
    let current = rootPath.value;
    const next = new Set(expanded.value);
    for (let i = 0; i < parts.length - 1; i += 1) {
      current = `${current}${sep}${parts[i]}`;
      next.add(current);
    }
    expanded.value = next;
    selectedPath.value = path;

    // 确保祖先目录已加载
    void (async () => {
      let cursor = rootPath.value!;
      if (!childrenMap.value[cursor]) await loadChildren(cursor);
      for (let i = 0; i < parts.length - 1; i += 1) {
        cursor = `${cursor}${sep}${parts[i]}`;
        if (!childrenMap.value[cursor]) await loadChildren(cursor);
      }
    })();
  }

  return {
    rootPath,
    rootName,
    notice,
    filter,
    selectedPath,
    childrenMap,
    expanded,
    recentFolders,
    clipboard,
    extraIgnores,
    flatTree,
    showNotice,
    openFolder,
    toggleExpand,
    refreshTree,
    createIn,
    renamePath,
    removePath,
    setClipboard,
    pasteInto,
    selectPath,
    revealPath,
    loadChildren,
  };
});
