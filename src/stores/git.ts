import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitConflictFiles,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiff,
  gitInit,
  gitLog,
  gitMergeBranch,
  gitPull,
  gitPush,
  gitRenameBranch,
  gitResetHard,
  gitResolveConflict,
  gitRevertTo,
  gitStage,
  gitStash,
  gitStashPop,
  gitStatus,
  gitUndoCommit,
  gitUnstage,
  type GitBranchInfo,
  type GitCommitInfo,
  type GitDiffResult,
  type GitStatusEntry,
  type GitStatusSnapshot,
} from "@/shared/gitApi";
import { useWorkspaceStore } from "@/stores/workspace";

const EMPTY: GitStatusSnapshot = {
  initialized: false,
  branch: null,
  upstream: null,
  entries: [],
  conflictCount: 0,
};

export const useGitStore = defineStore("git", () => {
  const snapshot = ref<GitStatusSnapshot>({ ...EMPTY });
  const branches = ref<GitBranchInfo[]>([]);
  const log = ref<GitCommitInfo[]>([]);
  const conflictFiles = ref<string[]>([]);
  const diffResults = ref<GitDiffResult[]>([]);
  const diffTitle = ref("");
  const diffVisible = ref(false);
  const loading = ref(false);
  const commitMessage = ref("");
  let refreshSeq = 0;
  let refreshAgain = false;

  const statusMap = computed(() => {
    const map = new Map<string, GitStatusEntry>();
    for (const e of snapshot.value.entries) {
      map.set(e.path, e);
    }
    return map;
  });

  const stagedEntries = computed(() =>
    snapshot.value.entries.filter((e) => e.staged && !e.conflicted),
  );

  const unstagedEntries = computed(() =>
    snapshot.value.entries.filter((e) => e.unstaged && !e.conflicted),
  );

  const conflictEntries = computed(() =>
    snapshot.value.entries.filter((e) => e.conflicted),
  );

  /** 有变更的文件数（含暂存/未暂存/冲突） */
  const changedFileCount = computed(() => snapshot.value.entries.length);

  async function refresh() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) {
      snapshot.value = { ...EMPTY };
      branches.value = [];
      conflictFiles.value = [];
      return;
    }
    // 合并并发刷新：进行中再触发则结束后补刷一次
    if (loading.value) {
      refreshAgain = true;
      return;
    }
    loading.value = true;
    const seq = ++refreshSeq;
    try {
      do {
        refreshAgain = false;
        const next = await gitStatus(workspace.rootPath);
        if (seq !== refreshSeq) return;
        snapshot.value = next;
        if (snapshot.value.initialized) {
          branches.value = await gitBranches(workspace.rootPath);
          if (seq !== refreshSeq) return;
          if (snapshot.value.conflictCount > 0) {
            conflictFiles.value = await gitConflictFiles(workspace.rootPath);
          } else {
            conflictFiles.value = [];
          }
        } else {
          branches.value = [];
          conflictFiles.value = [];
        }
      } while (refreshAgain && seq === refreshSeq);
    } catch (error) {
      if (seq === refreshSeq) {
        workspace.showNotice(
          error instanceof Error ? error.message : String(error),
          3200,
        );
      }
    } finally {
      if (seq === refreshSeq) loading.value = false;
    }
  }

  async function initRepo() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitInit(workspace.rootPath);
      workspace.showNotice("Git 仓库已初始化");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function stage(paths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !paths.length) return;
    try {
      await gitStage(workspace.rootPath, paths);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function unstage(paths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !paths.length) return;
    try {
      await gitUnstage(workspace.rootPath, paths);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function commit(message?: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    const msg = (message ?? commitMessage.value).trim();
    if (!msg) {
      workspace.showNotice("请输入提交说明");
      return;
    }
    try {
      await gitCommit(workspace.rootPath, msg);
      commitMessage.value = "";
      workspace.showNotice("提交成功");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function checkout(name: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitCheckout(workspace.rootPath, name);
      workspace.showNotice(`已切换到 ${name}`);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function createBranch(name: string, checkout = true) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitCreateBranch(workspace.rootPath, name, checkout);
      workspace.showNotice(`分支 ${name} 已创建`);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function deleteBranch(name: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (!window.confirm(`确定删除分支「${name}」？`)) return;
    try {
      await gitDeleteBranch(workspace.rootPath, name);
      workspace.showNotice(`分支 ${name} 已删除`);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function renameBranch(from: string, to: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitRenameBranch(workspace.rootPath, from, to);
      workspace.showNotice(`分支已重命名为 ${to}`);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function pull() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitPull(workspace.rootPath);
      workspace.showNotice(msg || "拉取完成");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function push(force = false) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (force && !window.confirm("确定强制推送？此操作可能覆盖远程历史。")) return;
    try {
      const msg = await gitPush(workspace.rootPath, force);
      workspace.showNotice(msg || "推送完成");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function stash(message?: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitStash(workspace.rootPath, message);
      workspace.showNotice("已暂存工作区更改");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function stashPop() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitStashPop(workspace.rootPath);
      workspace.showNotice("已恢复暂存");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function loadLog(limit = 30) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !snapshot.value.initialized) return;
    try {
      log.value = await gitLog(workspace.rootPath, limit);
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function showDiff(path?: string, staged?: boolean) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    // 分栏对比需要具体文件；整组 diff 仍回退为 patch 弹层
    if (path?.trim()) {
      const { useCompareStore } = await import("@/stores/compare");
      await useCompareStore().openDiff(path, staged ?? false);
      return;
    }
    try {
      const result = await gitDiff(workspace.rootPath, path, staged);
      diffResults.value = [result];
      diffTitle.value = staged ? "已暂存更改" : "工作区更改";
      diffVisible.value = true;
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  function closeDiff() {
    diffVisible.value = false;
    diffResults.value = [];
    diffTitle.value = "";
  }

  /** 切换工作区时清空仓库相关临时 UI 状态（随后会 refresh） */
  function clearForWorkspaceSwitch() {
    snapshot.value = { ...EMPTY };
    branches.value = [];
    log.value = [];
    conflictFiles.value = [];
    commitMessage.value = "";
    closeDiff();
    refreshSeq += 1;
    refreshAgain = false;
    loading.value = false;
  }

  async function openConflictCompare(path: string) {
    const { useCompareStore } = await import("@/stores/compare");
    await useCompareStore().openMerge(path);
  }

  async function resetHard() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (
      !window.confirm(
        "确定执行硬重置？所有未提交更改将永久丢失，此操作不可撤销。",
      )
    ) {
      return;
    }
    try {
      await gitResetHard(workspace.rootPath);
      workspace.showNotice("已硬重置到 HEAD");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function undoCommit() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (
      !window.confirm(
        "确定撤销最近一次提交？更改将保留在工作区。",
      )
    ) {
      return;
    }
    try {
      await gitUndoCommit(workspace.rootPath);
      workspace.showNotice("已撤销最近一次提交");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function revertTo(commitId: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (
      !window.confirm(
        `确定回退到 ${commitId.slice(0, 7)}？未提交更改可能丢失。`,
      )
    ) {
      return;
    }
    try {
      await gitRevertTo(workspace.rootPath, commitId);
      workspace.showNotice("已回退到指定提交");
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function mergeBranch(name: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitMergeBranch(workspace.rootPath, name);
      workspace.showNotice(typeof msg === "string" && msg ? msg : `已合并 ${name}`);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function resolveConflict(
    path: string,
    strategy: "ours" | "theirs" | "manual",
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitResolveConflict(workspace.rootPath, path, strategy);
      workspace.showNotice(
        strategy === "manual" ? "已标记为手动解决" : "冲突已解决",
      );
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  function statusColor(path: string): string | null {
    const entry = statusMap.value.get(path);
    if (!entry) return null;
    if (entry.conflicted) return "var(--danger)";
    if (entry.status === "untracked") return "var(--text-muted)";
    if (entry.staged) return "var(--success)";
    if (entry.unstaged) return "var(--warning)";
    return null;
  }

  return {
    snapshot,
    branches,
    log,
    conflictFiles,
    diffResults,
    diffTitle,
    diffVisible,
    loading,
    commitMessage,
    statusMap,
    stagedEntries,
    unstagedEntries,
    conflictEntries,
    changedFileCount,
    refresh,
    initRepo,
    stage,
    unstage,
    commit,
    checkout,
    createBranch,
    deleteBranch,
    renameBranch,
    pull,
    push,
    stash,
    stashPop,
    loadLog,
    showDiff,
    closeDiff,
    clearForWorkspaceSwitch,
    openConflictCompare,
    resetHard,
    undoCommit,
    revertTo,
    mergeBranch,
    resolveConflict,
    statusColor,
  };
});
