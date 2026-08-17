import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  gitBlame,
  gitBranchSides,
  gitBranches,
  gitCheckout,
  gitCheckoutCommit,
  gitCheckoutRemote,
  gitCherryPick,
  gitCommit,
  gitCreateBranch,
  gitCreateBranchAt,
  gitDeleteBranch,
  gitDeleteRemoteBranch,
  gitDiff,
  gitDiscardPaths,
  gitFetch,
  gitInit,
  gitLog,
  gitMergeBranch,
  gitPull,
  gitPush,
  gitRebaseAbort,
  gitRebaseBranch,
  gitRebaseContinue,
  gitRebaseInteractive,
  gitRebasePlan,
  gitRebaseSkip,
  gitRebaseStatus,
  gitRenameBranch,
  gitReset,
  gitResetHard,
  gitResolveConflict,
  gitRevertCommit,
  gitRevertTo,
  gitSetUpstream,
  gitStage,
  gitStash,
  gitStashApply,
  gitStashDrop,
  gitStashList,
  gitStashPop,
  gitStatus,
  gitUndoCommit,
  gitUnstage,
  gitUpdateProject,
  type GitAuthPayload,
  type GitBranchInfo,
  type GitCommitInfo,
  type GitDiffResult,
  type GitRebaseStatus,
  type GitRebaseStep,
  type GitStashEntry,
  type GitStatusEntry,
  type GitStatusSnapshot,
} from "@/shared/gitApi";
import { t } from "@/i18n";
import { relativeToRoot } from "@/shared/fs";
import { useWorkspaceStore } from "@/stores/workspace";

const EMPTY: GitStatusSnapshot = {
  initialized: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  entries: [],
  conflictCount: 0,
};

const EMPTY_REBASE: GitRebaseStatus = {
  inProgress: false,
  kind: "none",
  headName: null,
  onto: null,
  conflicted: false,
};

export const useGitStore = defineStore("git", () => {
  const snapshot = ref<GitStatusSnapshot>({ ...EMPTY });
  const branches = ref<GitBranchInfo[]>([]);
  const log = ref<GitCommitInfo[]>([]);
  const stashes = ref<GitStashEntry[]>([]);
  const logLimit = ref(80);
  const conflictFiles = ref<string[]>([]);
  const rebaseStatus = ref<GitRebaseStatus>({ ...EMPTY_REBASE });
  const diffResults = ref<GitDiffResult[]>([]);
  const diffTitle = ref("");
  const diffVisible = ref(false);
  const loading = ref(false);
  const commitMessage = ref("");
  const amendCommit = ref(false);
  /// 远端操作（push/pull/fetch/update）进行中：用于禁用重复点击。
  /// 注意：**不会**影响其他 UI 元素（活动栏/标签/资源树），
  /// 它们走完全独立的 store 与组件树，互不阻塞。
  const remoteInFlight = ref(false);
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

  /** 可勾选提交的变更（非冲突） */
  const changelistEntries = computed(() =>
    snapshot.value.entries.filter((e) => !e.conflicted),
  );

  /** 有变更的文件数（含暂存/未暂存/冲突） */
  const changedFileCount = computed(() => snapshot.value.entries.length);

  /** WebStorm 勾选态：path → 是否纳入本次提交；新文件默认勾选 */
  const checkedMap = ref<Record<string, boolean>>({});
  const selectedPath = ref<string | null>(null);

  const checkedPaths = computed(() =>
    changelistEntries.value
      .filter((e) => checkedMap.value[e.path] !== false)
      .map((e) => e.path),
  );

  const checkedCount = computed(() => checkedPaths.value.length);

  const allChecked = computed(
    () =>
      changelistEntries.value.length > 0 &&
      changelistEntries.value.every((e) => checkedMap.value[e.path] !== false),
  );

  function syncCheckedPaths() {
    const prev = checkedMap.value;
    const next: Record<string, boolean> = {};
    for (const e of changelistEntries.value) {
      next[e.path] = prev[e.path] ?? true;
    }
    checkedMap.value = next;
    if (
      selectedPath.value &&
      !snapshot.value.entries.some((e) => e.path === selectedPath.value)
    ) {
      selectedPath.value = null;
    }
  }

  function setPathChecked(path: string, checked: boolean) {
    checkedMap.value = { ...checkedMap.value, [path]: checked };
  }

  function setAllChecked(checked: boolean) {
    const next: Record<string, boolean> = {};
    for (const e of changelistEntries.value) {
      next[e.path] = checked;
    }
    checkedMap.value = next;
  }

  function selectChange(path: string | null) {
    selectedPath.value = path;
  }

  async function refresh() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) {
      snapshot.value = { ...EMPTY };
      branches.value = [];
      stashes.value = [];
      conflictFiles.value = [];
      checkedMap.value = {};
      selectedPath.value = null;
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
          // 与 gitStatus 结果相互独立的 3 项查询并行化，缩短整体阻塞
          const [branchesRes, stashesRes, rebaseRes] = await Promise.all([
            gitBranches(workspace.rootPath),
            gitStashList(workspace.rootPath).catch(() => []),
            gitRebaseStatus(workspace.rootPath).catch(() => ({
              ...EMPTY_REBASE,
            })),
          ]);
          if (seq !== refreshSeq) return;
          branches.value = branchesRes;
          stashes.value = stashesRes as typeof stashes.value;
          rebaseStatus.value = rebaseRes;
          // 冲突文件直接从 status 快照派生（entries 已带 conflicted 标记），
          // 省去 gitConflictFiles 内部再跑一次完整 status（此前在主线程重扫）
          conflictFiles.value =
            snapshot.value.conflictCount > 0
              ? snapshot.value.entries
                  .filter((e) => e.conflicted)
                  .map((e) => e.path)
              : [];
        } else {
          branches.value = [];
          stashes.value = [];
          conflictFiles.value = [];
          rebaseStatus.value = { ...EMPTY_REBASE };
        }
        if (seq === refreshSeq) syncCheckedPaths();
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
      workspace.showNotice(t("git.initOk"));
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

  async function commit(message?: string, paths?: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return false;
    const msg = (message ?? commitMessage.value).trim();
    if (!msg) {
      workspace.showNotice(t("git.needMessage"));
      return false;
    }
    // 显式 paths：先 stage 再提交；否则提交当前 index（已暂存）
    const explicit = paths?.length ? paths : undefined;
    if (!amendCommit.value && !explicit && !stagedEntries.value.length) {
      workspace.showNotice(t("git.needStaged"));
      return false;
    }
    try {
      await gitCommit(
        workspace.rootPath,
        msg,
        amendCommit.value ? undefined : explicit,
        amendCommit.value,
      );
      commitMessage.value = "";
      amendCommit.value = false;
      workspace.showNotice(t("git.commitOk"));
      await refresh();
      return true;
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
      return false;
    }
  }

  /** Commit and Push（WebStorm） */
  async function commitAndPush(message?: string) {
    const ok = await commit(message);
    if (!ok) return;
    await pushWithDialog();
  }

  async function checkout(name: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (snapshot.value.branch === name) return;

    const root = workspace.rootPath;
    const dirty = snapshot.value.entries.length > 0;

    try {
      await gitCheckout(root, name, false);
      workspace.showNotice(t("git.switchedTo", { name }));
      await refresh();
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 干净工作区，或明显不是「本地变更阻挡」：直接提示
      if (!shouldOfferDirtyCheckout(msg, dirty)) {
        workspace.showNotice(msg, 3200);
        return;
      }
    }

    // 有未提交变更且安全切换失败 → VS Code / WebStorm 风格处理
    const { promptChoice } = await import("@/shared/choiceDialog");
    const choice = await promptChoice({
      title: t("git.checkoutTitle"),
      message: t("git.checkoutDirtyMessage", { name }),
      choices: [
        { id: "cancel", label: t("common.cancel"), variant: "ghost" },
        { id: "force", label: t("git.forceCheckout"), variant: "danger" },
        { id: "smart", label: t("git.smartCheckout"), variant: "primary" },
      ],
      dismissId: "cancel",
    });

    if (!choice || choice === "cancel") return;

    try {
      if (choice === "smart") {
        await gitStash(root, `Miro Code: checkout ${name}`, true);
        await gitCheckout(root, name, false);
        try {
          await gitStashPop(root);
          workspace.showNotice(t("git.switchedRestored", { name }));
        } catch (popError) {
          const popMsg =
            popError instanceof Error ? popError.message : String(popError);
          workspace.showNotice(
            t("git.switchedStashConflict", { name, detail: popMsg }),
            4800,
          );
        }
      } else if (choice === "force") {
        await gitCheckout(root, name, true);
        workspace.showNotice(t("git.forceSwitched", { name }));
      }
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
      await refresh();
    }
  }

  function shouldOfferDirtyCheckout(message: string, dirty: boolean): boolean {
    if (!dirty) return false;
    const lower = message.toLowerCase();
    // 分支不存在等与本地变更无关的错误，不弹智能/强制
    if (
      lower.includes("not found") ||
      lower.includes("does not exist") ||
      lower.includes("ambiguous") ||
      message.includes("未找到")
    ) {
      return false;
    }
    return true;
  }

  async function createBranch(name: string, checkout = true) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitCreateBranch(workspace.rootPath, name, checkout);
      workspace.showNotice(t("git.branchCreated", { name }));
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
    if (!window.confirm(t("git.deleteBranchConfirm", { name }))) return;
    try {
      await gitDeleteBranch(workspace.rootPath, name);
      workspace.showNotice(t("git.branchDeleted", { name }));
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
      workspace.showNotice(t("git.branchRenamed", { name: to }));
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function pull() {
    await runRemoteWithAuth("pull");
  }

  async function push(force = false) {
    if (force && !window.confirm(t("git.forcePushConfirm"))) {
      return;
    }
    await runRemoteWithAuth("push", force);
  }

  /** WebStorm Push 对话框 */
  async function pushWithDialog() {
    const { openPushDialog } = await import("@/shared/gitDialogs");
    const result = await openPushDialog();
    if (!result) return;
    await runRemoteWithAuth("push", result.force);
  }

  /** WebStorm Update Project */
  async function updateProject() {
    const { openUpdateProjectDialog } = await import("@/shared/gitDialogs");
    const strategy = await openUpdateProjectDialog();
    if (!strategy) return;
    await runRemoteWithAuth("update", false, strategy);
  }

  async function fetchRemote() {
    await runRemoteWithAuth("fetch");
  }

  /** 认证失败时弹出账号密码框并重试（对齐 WebStorm） */
  async function runRemoteWithAuth(
    kind: "pull" | "push" | "fetch" | "update",
    force = false,
    updateStrategy: "merge" | "rebase" = "merge",
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    // 防止用户连点 push/pull 按钮导致后端并发调用同一 git 操作
    if (remoteInFlight.value) {
      workspace.showNotice(t("git.remoteInFlight"), 2400);
      return;
    }
    remoteInFlight.value = true;
    const root = workspace.rootPath;
    let auth: GitAuthPayload | undefined;
    let lastUser = "";
    // 最多 1 次重试：第 0 次尝试 → 失败弹窗 → 第 1 次尝试用新凭据；仍认证失败则停止弹窗
    const MAX_ATTEMPTS = 2;

    // 进入远端操作前先发一条"进行中"notice，避免网络慢/认证中时 UI 看起来卡死。
    // 持续时长留 0，让后续的成功/失败 notice 自然覆盖它。
    const progressMessages: Record<typeof kind, string> = {
      push: t("git.pushing"),
      pull: t("git.pulling"),
      fetch: t("git.fetching"),
      update: t("git.updating"),
    };
    workspace.showNotice(progressMessages[kind]);

    try {
      await runRemoteWithAuthInner(kind, force, updateStrategy, root, auth, lastUser, MAX_ATTEMPTS, workspace);
    } finally {
      remoteInFlight.value = false;
    }
  }

  async function runRemoteWithAuthInner(
    kind: "pull" | "push" | "fetch" | "update",
    force: boolean,
    updateStrategy: "merge" | "rebase",
    root: string,
    auth: GitAuthPayload | undefined,
    lastUserIn: string,
    maxAttempts: number,
    workspace: ReturnType<typeof useWorkspaceStore>,
  ) {
    let authLocal = auth;
    let lastUser = lastUserIn;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        let msg = "";
        if (kind === "pull") msg = await gitPull(root, authLocal);
        else if (kind === "push") msg = await gitPush(root, force, authLocal);
        else if (kind === "fetch") msg = await gitFetch(root, "origin", authLocal);
        else msg = await gitUpdateProject(root, updateStrategy, authLocal);
        const remembered = authLocal?.remember === true;
        const fallback = msg || t("git.done");
        workspace.showNotice(
          remembered ? t("git.doneRemembered", { msg: fallback }) : fallback,
        );
        await refresh();
        return;
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const parsed = parseGitAuthError(raw);
        if (!parsed) {
          workspace.showNotice(raw, 4800);
          return;
        }
        // 已用新凭据重试一次仍失败：不再继续弹窗，避免死循环
        if (attempt + 1 >= maxAttempts) {
          workspace.showNotice(
            t("git.authFailedGiveUp", { detail: parsed.detail }),
            6000,
          );
          return;
        }
        const { promptGitAuth } = await import("@/shared/gitAuthDialog");
        const titles: Record<typeof kind, string> = {
          pull: t("git.authPull"),
          push: t("git.authPush"),
          fetch: t("git.authFetch"),
          update: t("git.authUpdate"),
        };
        let defaultUsername = lastUser || guessUsernameFromUrl(parsed.url);
        if (!defaultUsername && parsed.url) {
          try {
            const { gitStoredUsername } = await import("@/shared/gitApi");
            defaultUsername = (await gitStoredUsername(parsed.url)) ?? "";
          } catch {
            /* 忽略预填失败 */
          }
        }
        const next = await promptGitAuth({
          title: titles[kind],
          remoteUrl: parsed.url,
          message: authLocal ? t("git.authRetry") : t("git.authRequired"),
          defaultUsername,
        });
        if (!next) return;
        lastUser = next.username;
        authLocal = {
          username: next.username,
          password: next.password,
          remember: next.remember,
        };
      }
    }
  }

  function parseGitAuthError(raw: string): { url: string; detail: string } | null {
    const idx = raw.indexOf("GIT_AUTH_REQUIRED|||");
    if (idx < 0) return null;
    const body = raw.slice(idx);
    const parts = body.split("|||");
    if (parts[0] !== "GIT_AUTH_REQUIRED") return null;
    return {
      url: parts[1] ?? "",
      detail: parts.slice(2).join("|||"),
    };
  }

  function guessUsernameFromUrl(url: string): string {
    // https://user@host/... 
    const m = url.match(/^https?:\/\/([^/@]+)@/i);
    return m?.[1] ?? "";
  }

  async function stash(message?: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitStash(workspace.rootPath, message);
      workspace.showNotice(t("git.stashOk"));
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function stashPop(index = 0) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitStashPop(workspace.rootPath, index);
      workspace.showNotice(t("git.stashPopOk"));
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function stashApply(index: number) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitStashApply(workspace.rootPath, index);
      workspace.showNotice(t("git.stashApplyOk"));
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function stashDrop(index: number) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (!confirm(t("git.stashDropConfirm", { index }))) return;
    try {
      await gitStashDrop(workspace.rootPath, index);
      workspace.showNotice(t("git.stashDropOk"));
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function discard(paths: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !paths.length) return;
    try {
      await gitDiscardPaths(workspace.rootPath, paths);
      const { useEditorStore } = await import("@/stores/editor");
      await useEditorStore().reloadAfterDiscard(paths);
      workspace.showNotice(
        paths.length === 1
          ? t("git.discardedOne")
          : t("git.discardedMany", { count: paths.length }),
      );
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function discardAll() {
    const paths = unstagedEntries.value.map((e) => e.path);
    if (!paths.length) {
      useWorkspaceStore().showNotice(t("git.nothingToDiscard"));
      return;
    }
    await discard(paths);
  }

  async function loadLog(limit?: number) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !snapshot.value.initialized) return;
    const nextLimit = limit ?? logLimit.value;
    logLimit.value = nextLimit;
    // 与 refresh 同款序号防护：等待期间切换工作区，旧仓库日志不得写入新工作区
    const seq = refreshSeq;
    try {
      const result = await gitLog(workspace.rootPath, nextLimit);
      if (seq !== refreshSeq) return;
      log.value = result;
    } catch (error) {
      if (seq !== refreshSeq) return;
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function loadMoreLog() {
    await loadLog(logLimit.value + 80);
  }

  function noticeRebaseConflict(raw: string) {
    const workspace = useWorkspaceStore();
    const idx = raw.indexOf("GIT_REBASE_CONFLICT|||");
    const msg =
      idx >= 0
        ? raw.slice(idx + "GIT_REBASE_CONFLICT|||".length).trim()
        : raw;
    workspace.showNotice(msg || t("git.rebaseConflictDefault"), 5200);
    void useSettingsStoreOpenCommit();
  }

  async function useSettingsStoreOpenCommit() {
    const { useSettingsStore } = await import("@/stores/settings");
    const settings = useSettingsStore();
    settings.setActivePanel("commit");
    settings.setSidebarCollapsed(false);
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
      diffTitle.value = staged
        ? t("git.stagedChanges")
        : t("git.workingChanges");
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
    stashes.value = [];
    logLimit.value = 80;
    conflictFiles.value = [];
    rebaseStatus.value = { ...EMPTY_REBASE };
    commitMessage.value = "";
    amendCommit.value = false;
    checkedMap.value = {};
    selectedPath.value = null;
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
      !window.confirm(t("git.resetHardConfirm"))
    ) {
      return;
    }
    try {
      await gitResetHard(workspace.rootPath);
      workspace.showNotice(t("git.resetHardOk"));
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
      !window.confirm(t("git.undoCommitConfirm"))
    ) {
      return;
    }
    try {
      await gitUndoCommit(workspace.rootPath);
      workspace.showNotice(t("git.undoCommitOk"));
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
        t("git.revertToConfirm", { hash: commitId.slice(0, 7) }),
      )
    ) {
      return;
    }
    try {
      await gitRevertTo(workspace.rootPath, commitId);
      workspace.showNotice(t("git.revertToOk"));
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
      workspace.showNotice(
        typeof msg === "string" && msg ? msg : t("git.merged", { name }),
      );
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function rebaseBranch(onto: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitRebaseBranch(workspace.rootPath, onto);
      workspace.showNotice(msg || t("git.rebasedOnto", { onto }));
      await refresh();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (raw.includes("GIT_REBASE_CONFLICT|||")) noticeRebaseConflict(raw);
      else workspace.showNotice(raw, 4800);
      await refresh();
    }
  }

  async function rebaseContinue() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitRebaseContinue(workspace.rootPath);
      workspace.showNotice(msg || t("git.rebaseContinued"));
      await refresh();
      await loadLog();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (raw.includes("GIT_REBASE_CONFLICT|||")) noticeRebaseConflict(raw);
      else workspace.showNotice(raw, 4800);
      await refresh();
    }
  }

  async function rebaseAbort() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (!window.confirm(t("git.rebaseAbortConfirm"))) {
      return;
    }
    try {
      const msg = await gitRebaseAbort(workspace.rootPath);
      workspace.showNotice(msg || t("git.rebaseAborted"));
      await refresh();
      await loadLog();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function rebaseSkip() {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitRebaseSkip(workspace.rootPath);
      workspace.showNotice(msg || t("git.rebaseSkipped"));
      await refresh();
      await loadLog();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (raw.includes("GIT_REBASE_CONFLICT|||")) noticeRebaseConflict(raw);
      else workspace.showNotice(raw, 4800);
      await refresh();
    }
  }

  async function startInteractiveRebase(onto: string, steps: GitRebaseStep[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitRebaseInteractive(workspace.rootPath, onto, steps);
      workspace.showNotice(msg || t("git.interactiveRebaseDone"));
      await refresh();
      await loadLog();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (raw.includes("GIT_REBASE_CONFLICT|||")) noticeRebaseConflict(raw);
      else workspace.showNotice(raw, 4800);
      await refresh();
      await loadLog();
    }
  }

  async function loadRebasePlan(onto: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return [];
    try {
      return await gitRebasePlan(workspace.rootPath, onto);
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
      return [];
    }
  }

  async function setUpstream(branch: string, upstream: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitSetUpstream(workspace.rootPath, branch, upstream);
      workspace.showNotice(t("git.upstreamSet", { upstream }));
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function deleteRemoteBranch(remoteRef: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (
      !window.confirm(t("git.deleteRemoteConfirm", { ref: remoteRef }))
    ) {
      return;
    }
    try {
      const msg = await gitDeleteRemoteBranch(workspace.rootPath, remoteRef);
      workspace.showNotice(msg);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        4800,
      );
    }
  }

  async function compareBranchWithCurrent(other: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !snapshot.value.branch) return;
    const root = workspace.rootPath;
    try {
      const sides = await gitBranchSides(
        workspace.rootPath,
        snapshot.value.branch,
        other,
      );
      // 等待期间已切换工作区：旧仓库的对比标签不得落入新工作区
      if (workspace.rootPath !== root) return;
      const { useCompareStore } = await import("@/stores/compare");
      const compare = useCompareStore();
      // upsert：同一分支重复对比时合并为同一标签，避免无限累积
      compare.upsertTab({
        id: `branch-diff-${Date.now()}`,
        kind: "diff",
        path: sides.path,
        title: t("git.branchCompare", { path: sides.path }),
        leftLabel: sides.leftLabel,
        rightLabel: sides.rightLabel,
        left: sides.left,
        right: sides.right,
        editableRight: false,
      });
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function createBranchAt(
    name: string,
    commitId: string,
    checkout: boolean,
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      await gitCreateBranchAt(workspace.rootPath, name, commitId, checkout);
      workspace.showNotice(
        checkout
          ? t("git.createdAndSwitched", { name })
          : t("git.branchCreatedAt", { name }),
      );
      await refresh();
      await loadLog();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function checkoutCommit(commitId: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    if (
      !window.confirm(
        t("git.checkoutCommitConfirm", { hash: commitId.slice(0, 7) }),
      )
    ) {
      return;
    }
    try {
      const msg = await gitCheckoutCommit(workspace.rootPath, commitId);
      workspace.showNotice(msg);
      await refresh();
      await loadLog();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function revertCommit(commitId: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitRevertCommit(workspace.rootPath, commitId);
      workspace.showNotice(msg);
      await refresh();
      await loadLog();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        4800,
      );
      await refresh();
    }
  }

  async function resolveAllConflicts(strategy: "ours" | "theirs") {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    const paths = conflictEntries.value.map((e) => e.path);
    if (!paths.length) return;
    try {
      for (const path of paths) {
        await gitResolveConflict(workspace.rootPath, path, strategy);
      }
      workspace.showNotice(
        strategy === "ours" ? t("git.acceptAllOurs") : t("git.acceptAllTheirs"),
      );
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
      await refresh();
    }
  }

  async function openFirstConflict() {
    await useSettingsStoreOpenCommit();
    const path = conflictEntries.value[0]?.path;
    if (path) await openConflictCompare(path);
  }

  async function checkoutRemote(remoteRef: string, localName?: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitCheckoutRemote(
        workspace.rootPath,
        remoteRef,
        localName,
      );
      workspace.showNotice(msg);
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function cherryPick(commitId: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitCherryPick(workspace.rootPath, commitId);
      workspace.showNotice(msg);
      await refresh();
      await loadLog();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        4800,
      );
      await refresh();
    }
  }

  async function resetTo(
    commitId: string,
    mode: "soft" | "mixed" | "hard",
  ) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    const label =
      mode === "hard"
        ? t("git.resetHardLabel")
        : mode === "soft"
          ? t("git.resetSoftLabel")
          : t("git.resetMixedLabel");
    if (
      !window.confirm(
        t("git.resetConfirm", { hash: commitId.slice(0, 7), label }),
      )
    )
      return;
    try {
      const msg = await gitReset(workspace.rootPath, commitId, mode);
      workspace.showNotice(msg);
      await refresh();
      await loadLog();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  async function blameFile(path: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return [];
    try {
      return await gitBlame(workspace.rootPath, path);
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
      return [];
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
        strategy === "manual" ? t("git.conflictManual") : t("git.conflictResolved"),
      );
      await refresh();
    } catch (error) {
      workspace.showNotice(
        error instanceof Error ? error.message : String(error),
        3200,
      );
    }
  }

  /**
   * 把绝对或相对路径归一为 statusMap 可查询的 key
   * - statusMap 的 key 是 libgit2 输出的「相对仓库根 / 正斜杠」路径
   * - 调用方传绝对路径时这里做 relativeToRoot 转换
   * - 优先 relative fallback to norm，吸收 Windows 反斜杠与大小写差异
   */
  function lookupStatusEntry(path: string): GitStatusEntry | null {
    if (!path) return null;
    const norm = path.replace(/\\/g, "/");
    const rootPath = useWorkspaceStore().rootPath;
    const rel = rootPath ? relativeToRoot(rootPath, norm) || norm : norm;
    return statusMap.value.get(rel) ?? statusMap.value.get(norm) ?? null;
  }

  /** 查 GitStatusEntry；供 ExplorerPanel / EditorArea 等需要原始 entry 的场景 */
  function statusEntry(path: string) {
    return lookupStatusEntry(path);
  }

  function statusColor(path: string): string | null {
    const entry = lookupStatusEntry(path);
    if (!entry) return null;
    if (entry.conflicted) return "var(--danger)";
    if (entry.status === "untracked") return "var(--success)";
    if (entry.staged) return "var(--success)";
    if (entry.unstaged) return "var(--warning)";
    return null;
  }

  /** 状态字母 badge：M / U / D / R / C（与 CommitPanel / Explorer 共享） */
  function statusLabel(status: string): string {
    const map: Record<string, string> = {
      modified: "M",
      untracked: "U",
      deleted: "D",
      renamed: "R",
      conflict: "C",
      changed: "M",
    };
    return map[status] ?? status.slice(0, 1).toUpperCase();
  }

  /** 状态中文 title（hover tooltip） */
  function statusTitle(status: string): string {
    const map: Record<string, string> = {
      modified: t("git.statusModified"),
      untracked: t("git.statusUntracked"),
      deleted: t("git.statusDeleted"),
      renamed: t("git.statusRenamed"),
      conflict: t("git.statusConflict"),
      changed: t("git.statusChanged"),
    };
    return map[status] ?? status;
  }

  /** 状态 CSS class（与 CommitPanel .st-* 同款） */
  function statusClass(status: string): string {
    if (status === "untracked") return "st-untracked";
    if (status === "deleted") return "st-deleted";
    if (status === "conflict") return "st-conflict";
    if (status === "renamed") return "st-renamed";
    return "st-modified";
  }

  return {
    snapshot,
    branches,
    log,
    stashes,
    logLimit,
    conflictFiles,
    rebaseStatus,
    diffResults,
    diffTitle,
    diffVisible,
    loading,
    remoteInFlight,
    commitMessage,
    amendCommit,
    statusMap,
    stagedEntries,
    unstagedEntries,
    conflictEntries,
    changelistEntries,
    changedFileCount,
    checkedMap,
    checkedPaths,
    checkedCount,
    allChecked,
    selectedPath,
    setPathChecked,
    setAllChecked,
    selectChange,
    refresh,
    initRepo,
    stage,
    unstage,
    commit,
    commitAndPush,
    checkout,
    createBranch,
    deleteBranch,
    renameBranch,
    pull,
    push,
    pushWithDialog,
    updateProject,
    fetchRemote,
    stash,
    stashPop,
    stashApply,
    stashDrop,
    discard,
    discardAll,
    loadLog,
    loadMoreLog,
    showDiff,
    closeDiff,
    clearForWorkspaceSwitch,
    openConflictCompare,
    openFirstConflict,
    resetHard,
    undoCommit,
    revertTo,
    revertCommit,
    mergeBranch,
    rebaseBranch,
    rebaseContinue,
    rebaseAbort,
    rebaseSkip,
    startInteractiveRebase,
    loadRebasePlan,
    setUpstream,
    deleteRemoteBranch,
    compareBranchWithCurrent,
    createBranchAt,
    checkoutCommit,
    checkoutRemote,
    cherryPick,
    resetTo,
    blameFile,
    resolveConflict,
    resolveAllConflicts,
    statusEntry,
    statusColor,
    statusLabel,
    statusTitle,
    statusClass,
  };
});
