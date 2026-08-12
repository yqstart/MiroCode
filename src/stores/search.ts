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
  const quickOpenVisible = ref(false);
  const findInFilesVisible = ref(false);
  // 请求序号：只应用最后一次发起的搜索，丢弃过期（被后续搜索/关闭覆盖）的结果
  let contentSearchSeq = 0;
  let fileSearchSeq = 0;

  function parseExtensions(): string[] | undefined {
    const raw = extensions.value.trim();
    if (!raw) return undefined;
    return raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().replace(/^\./, ""))
      .filter(Boolean);
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
    // 请求序号：快速输入时只保留最后一次的响应，旧的返回直接丢弃
    const seq = ++fileSearchSeq;
    loading.value = true;
    try {
      const result = await Promise.race([
        searchFiles(workspace.rootPath, q, {
          maxResults: 50,
          extraIgnores: workspace.extraIgnores,
          extensions: parseExtensions(),
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("搜索超时（15s），请缩小范围或重试")),
            15_000,
          ),
        ),
      ]);
      if (seq !== fileSearchSeq) return; // 已有更新的搜索，丢弃过期结果
      fileResults.value = result;
    } catch (error) {
      if (seq !== fileSearchSeq) return;
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    } finally {
      if (seq === fileSearchSeq) loading.value = false;
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
    const seq = ++contentSearchSeq;
    loading.value = true;
    try {
      // 前端 30s 超时兜底：即使后端 IPC 卡死（线程毒化 / walk 无响应），
      // 也能恢复 loading 状态，避免「搜索中」永远转圈
      const result = await Promise.race([
        searchContent(workspace.rootPath, q, {
          maxResults: 200,
          caseSensitive: caseSensitive.value,
          extraIgnores: workspace.extraIgnores,
          extensions: parseExtensions(),
          contextLines: 0,
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("搜索超时（30s），请缩小范围或重试")),
            30_000,
          ),
        ),
      ]);
      // 若期间发起了新的搜索或已关闭，丢弃本次过期结果
      if (seq !== contentSearchSeq) return;
      contentResults.value = result;
    } catch (error) {
      if (seq !== contentSearchSeq) return;
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    } finally {
      if (seq === contentSearchSeq) loading.value = false;
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
    // 每次打开都重置状态，避免上次卡住的 loading / 残留结果影响体验
    contentSearchSeq += 1;
    loading.value = false;
    contentResults.value = [];
    replacePreview.value = null;
    findInFilesVisible.value = true;
  }

  function closeFindInFiles() {
    findInFilesVisible.value = false;
    // 使进行中的搜索结果失效 + 重置 loading
    contentSearchSeq += 1;
    loading.value = false;
    contentResults.value = [];
    replacePreview.value = null;
  }

  function clearResults() {
    fileResults.value = [];
    contentResults.value = [];
    replacePreview.value = null;
    // 使进行中的搜索结果失效
    contentSearchSeq += 1;
    loading.value = false;
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
  };
});
