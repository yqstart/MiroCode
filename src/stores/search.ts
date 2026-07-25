import { ref } from "vue";
import { defineStore } from "pinia";
import {
  replaceInFiles,
  searchContent,
  searchFiles,
  type ContentHit,
  type FileSearchHit,
  type ReplaceResult,
} from "@/shared/searchApi";
import { useWorkspaceStore } from "@/stores/workspace";

const HISTORY_KEY = "mirocode.search.history.v1";
const MAX_HISTORY = 20;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

export const useSearchStore = defineStore("search", () => {
  const fileQuery = ref("");
  const contentQuery = ref("");
  const replaceText = ref("");
  const caseSensitive = ref(false);
  const extensions = ref("");
  const fileResults = ref<FileSearchHit[]>([]);
  const contentResults = ref<ContentHit[]>([]);
  const replacePreview = ref<ReplaceResult | null>(null);
  const loading = ref(false);
  const history = ref<string[]>(loadHistory());
  const quickOpenVisible = ref(false);
  const findInFilesVisible = ref(false);

  function parseExtensions(): string[] | undefined {
    const raw = extensions.value.trim();
    if (!raw) return undefined;
    return raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().replace(/^\./, ""))
      .filter(Boolean);
  }

  function pushHistory(query: string) {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...history.value.filter((h) => h !== q)].slice(0, MAX_HISTORY);
    history.value = next;
    saveHistory(next);
  }

  async function runFileSearch(query?: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    const q = (query ?? fileQuery.value).trim();
    fileQuery.value = q;
    if (!q) {
      fileResults.value = [];
      return;
    }
    loading.value = true;
    try {
      fileResults.value = await searchFiles(workspace.rootPath, q, {
        maxResults: 50,
        extraIgnores: workspace.extraIgnores,
        extensions: parseExtensions(),
      });
      pushHistory(q);
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    } finally {
      loading.value = false;
    }
  }

  async function runContentSearch() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    const q = contentQuery.value.trim();
    if (!q) {
      contentResults.value = [];
      return;
    }
    loading.value = true;
    try {
      contentResults.value = await searchContent(workspace.rootPath, q, {
        maxResults: 200,
        caseSensitive: caseSensitive.value,
        extraIgnores: workspace.extraIgnores,
        extensions: parseExtensions(),
        contextLines: 0,
      });
      pushHistory(q);
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    } finally {
      loading.value = false;
    }
  }

  async function previewReplace() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    const q = contentQuery.value.trim();
    if (!q) return;
    loading.value = true;
    try {
      replacePreview.value = await replaceInFiles(
        workspace.rootPath,
        q,
        replaceText.value,
        {
          dryRun: true,
          caseSensitive: caseSensitive.value,
          extraIgnores: workspace.extraIgnores,
          extensions: parseExtensions(),
        },
      );
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    } finally {
      loading.value = false;
    }
  }

  async function applyReplace() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    const q = contentQuery.value.trim();
    if (!q) return;
    loading.value = true;
    try {
      const result = await replaceInFiles(
        workspace.rootPath,
        q,
        replaceText.value,
        {
          dryRun: false,
          caseSensitive: caseSensitive.value,
          extraIgnores: workspace.extraIgnores,
          extensions: parseExtensions(),
        },
      );
      replacePreview.value = result;
      workspace.showNotice(
        `已替换 ${result.replacements} 处，涉及 ${result.changedFiles} 个文件`,
      );
      await runContentSearch();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    } finally {
      loading.value = false;
    }
  }

  function openQuickOpen() {
    findInFilesVisible.value = false;
    quickOpenVisible.value = true;
    fileQuery.value = "";
    fileResults.value = [];
  }

  function closeQuickOpen() {
    quickOpenVisible.value = false;
  }

  function openFindInFiles() {
    quickOpenVisible.value = false;
    findInFilesVisible.value = true;
  }

  function closeFindInFiles() {
    findInFilesVisible.value = false;
  }

  function clearResults() {
    fileResults.value = [];
    contentResults.value = [];
    replacePreview.value = null;
  }

  return {
    fileQuery,
    contentQuery,
    replaceText,
    caseSensitive,
    extensions,
    fileResults,
    contentResults,
    replacePreview,
    loading,
    history,
    quickOpenVisible,
    findInFilesVisible,
    runFileSearch,
    runContentSearch,
    previewReplace,
    applyReplace,
    openQuickOpen,
    closeQuickOpen,
    openFindInFiles,
    closeFindInFiles,
    clearResults,
    pushHistory,
  };
});
