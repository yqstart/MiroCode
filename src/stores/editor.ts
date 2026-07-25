import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { basename, languageFromPath, readTextFile, writeTextFile } from "@/shared/fs";
import type { EditorJumpTarget, EditorOpenAt } from "@/shared/types";
import { useGitStore } from "@/stores/git";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string;
  original: string;
  language: string;
  cursor: { line: number; column: number };
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

  const dirtyPaths = computed(() =>
    new Set(tabs.value.filter((t) => t.content !== t.original).map((t) => t.path)),
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

    const existing = tabs.value.find((t) => t.path === path);
    if (existing) {
      activePath.value = path;
      workspace.selectPath(path);
      workspace.revealPath(path);
      return;
    }

    try {
      const content = await readTextFile(workspace.rootPath, path);
      tabs.value.push({
        id: path,
        path,
        name: basename(path),
        content,
        original: content,
        language: languageFromPath(path),
        cursor: { line: 1, column: 1 },
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

  function setCursor(path: string, line: number, column: number) {
    const tab = tabs.value.find((t) => t.path === path);
    if (!tab) return;
    tab.cursor = { line, column };
  }

  function activate(path: string) {
    useSessionsStore().blurSessions();
    activePath.value = path;
    const workspace = useWorkspaceStore();
    workspace.selectPath(path);
    workspace.revealPath(path);
  }

  async function saveActive() {
    const workspace = useWorkspaceStore();
    const git = useGitStore();
    if (!workspace.rootPath || !activeTab.value) {
      workspace.showNotice("当前无活动文件可保存");
      return;
    }
    const tab = activeTab.value;
    try {
      await writeTextFile(workspace.rootPath, tab.path, tab.content);
      tab.original = tab.content;
      workspace.showNotice(`已保存 ${tab.name}`);
      void git.refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function saveAll() {
    const workspace = useWorkspaceStore();
    const git = useGitStore();
    if (!workspace.rootPath) return;
    for (const tab of tabs.value) {
      if (tab.content === tab.original) continue;
      await writeTextFile(workspace.rootPath, tab.path, tab.content);
      tab.original = tab.content;
    }
    workspace.showNotice("已保存全部");
    void git.refresh();
  }

  async function closeTab(path: string) {
    const tab = tabs.value.find((t) => t.path === path);
    if (!tab) return;
    if (tab.content !== tab.original) {
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

  function renameTabPath(from: string, to: string) {
    const tab = tabs.value.find((t) => t.path === from);
    if (!tab) return;
    tab.path = to;
    tab.id = to;
    tab.name = basename(to);
    tab.language = languageFromPath(to);
    if (activePath.value === from) activePath.value = to;
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
    setCursor,
    activate,
    saveActive,
    saveAll,
    closeTab,
    renameTabPath,
    closeTabsUnder,
  };
});
