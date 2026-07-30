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
  gitConflictFiles,
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
  type GitStatusEntry,
  type GitStatusSnapshot,
} from "@/shared/gitApi";
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
  const logLimit = ref(80);
  const conflictFiles = ref<string[]>([]);
  const rebaseStatus = ref<GitRebaseStatus>({ ...EMPTY_REBASE });
  const diffResults = ref<GitDiffResult[]>([]);
  const diffTitle = ref("");
  const diffVisible = ref(false);
  const loading = ref(false);
  const commitMessage = ref("");
  const amendCommit = ref(false);
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
          branches.value = await gitBranches(workspace.rootPath);
          if (seq !== refreshSeq) return;
          try {
            rebaseStatus.value = await gitRebaseStatus(workspace.rootPath);
          } catch {
            rebaseStatus.value = { ...EMPTY_REBASE };
          }
          if (seq !== refreshSeq) return;
          if (snapshot.value.conflictCount > 0) {
            conflictFiles.value = await gitConflictFiles(workspace.rootPath);
          } else {
            conflictFiles.value = [];
          }
        } else {
          branches.value = [];
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

  async function commit(message?: string, paths?: string[]) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return false;
    const msg = (message ?? commitMessage.value).trim();
    if (!msg) {
      workspace.showNotice("请输入提交说明");
      return false;
    }
    const selected = paths ?? checkedPaths.value;
    if (!amendCommit.value && !selected.length) {
      workspace.showNotice("请至少勾选一个文件再提交");
      return false;
    }
    try {
      await gitCommit(
        workspace.rootPath,
        msg,
        amendCommit.value ? undefined : selected,
        amendCommit.value,
      );
      commitMessage.value = "";
      amendCommit.value = false;
      workspace.showNotice("提交成功");
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
      workspace.showNotice(`已切换到 ${name}`);
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
      title: "切换分支",
      message:
        `本地有未提交变更，直接切换到「${name}」可能覆盖这些文件。\n\n` +
        `· 智能切换：先贮藏冲突变更，切换后再恢复（WebStorm）\n` +
        `· 强制切换：丢弃本地变更后切换（VS Code）`,
      choices: [
        { id: "cancel", label: "取消", variant: "ghost" },
        { id: "force", label: "强制切换", variant: "danger" },
        { id: "smart", label: "智能切换", variant: "primary" },
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
          workspace.showNotice(`已切换到 ${name}（变更已恢复）`);
        } catch (popError) {
          const popMsg =
            popError instanceof Error ? popError.message : String(popError);
          workspace.showNotice(
            `已切换到 ${name}，但恢复贮藏时出现冲突：${popMsg}`,
            4800,
          );
        }
      } else if (choice === "force") {
        await gitCheckout(root, name, true);
        workspace.showNotice(`已强制切换到 ${name}（本地变更已丢弃）`);
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
    await runRemoteWithAuth("pull");
  }

  async function push(force = false) {
    if (force && !window.confirm("确定强制推送？此操作可能覆盖远程历史。")) {
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
    const root = workspace.rootPath;
    let auth: GitAuthPayload | undefined;
    let lastUser = "";

    for (;;) {
      try {
        let msg = "";
        if (kind === "pull") msg = await gitPull(root, auth);
        else if (kind === "push") msg = await gitPush(root, force, auth);
        else if (kind === "fetch") msg = await gitFetch(root, "origin", auth);
        else msg = await gitUpdateProject(root, updateStrategy, auth);
        const remembered = auth?.remember === true;
        workspace.showNotice(
          remembered ? `${msg || "完成"}（已记住登录）` : msg || "完成",
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
        const { promptGitAuth } = await import("@/shared/gitAuthDialog");
        const titles: Record<typeof kind, string> = {
          pull: "拉取需要登录",
          push: "推送需要登录",
          fetch: "Fetch 需要登录",
          update: "更新需要登录",
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
          message: auth
            ? "账号或密码不正确，请重试"
            : "远程需要认证，请输入账号与密码",
          defaultUsername,
        });
        if (!next) return;
        lastUser = next.username;
        auth = {
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
      workspace.showNotice("已贮藏工作区更改");
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
      workspace.showNotice("已弹出贮藏");
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
        paths.length === 1 ? "已回滚变更" : `已回滚 ${paths.length} 个文件的变更`,
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
      useWorkspaceStore().showNotice("没有可丢弃的更改");
      return;
    }
    await discard(paths);
  }

  async function loadLog(limit?: number) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath || !snapshot.value.initialized) return;
    const nextLimit = limit ?? logLimit.value;
    logLimit.value = nextLimit;
    try {
      log.value = await gitLog(workspace.rootPath, nextLimit);
    } catch (error) {
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
    workspace.showNotice(msg || "Rebase 产生冲突，请解决后 Continue", 5200);
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

  async function rebaseBranch(onto: string) {
    const workspace = useWorkspaceStore();
    if (!workspace.rootPath) return;
    try {
      const msg = await gitRebaseBranch(workspace.rootPath, onto);
      workspace.showNotice(msg || `已 rebase 到 ${onto}`);
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
      workspace.showNotice(msg || "Rebase 已继续");
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
    if (!window.confirm("确定中止 Rebase？工作区将恢复到 rebase 开始前。")) {
      return;
    }
    try {
      const msg = await gitRebaseAbort(workspace.rootPath);
      workspace.showNotice(msg || "已中止 Rebase");
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
      workspace.showNotice(msg || "已跳过");
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
      workspace.showNotice(msg || "交互 Rebase 完成");
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
      workspace.showNotice(`已设置上游 ${upstream}`);
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
      !window.confirm(
        `确定删除远程分支 ${remoteRef}？此操作不可轻易撤销。`,
      )
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
    try {
      const sides = await gitBranchSides(
        workspace.rootPath,
        snapshot.value.branch,
        other,
      );
      const { useCompareStore } = await import("@/stores/compare");
      const compare = useCompareStore();
      const id = `branch-diff-${Date.now()}`;
      compare.tabs.push({
        id,
        kind: "diff",
        path: sides.path,
        title: `${sides.path} · 分支对比`,
        leftLabel: sides.leftLabel,
        rightLabel: sides.rightLabel,
        left: sides.left,
        right: sides.right,
        editableRight: false,
      });
      compare.activate(id);
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
        checkout ? `已创建并切换到 ${name}` : `已创建分支 ${name}`,
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
        `确定检出提交 ${commitId.slice(0, 7)}？（分离 HEAD）`,
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
        strategy === "ours" ? "已全部接受本地版本" : "已全部接受远程版本",
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
      mode === "hard" ? "硬重置（丢弃工作区）" : mode === "soft" ? "软重置" : "混合重置";
    if (!window.confirm(`确定对 ${commitId.slice(0, 7)} 执行${label}？`)) return;
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
    if (entry.status === "untracked") return "var(--success)";
    if (entry.staged) return "var(--success)";
    if (entry.unstaged) return "var(--warning)";
    return null;
  }

  return {
    snapshot,
    branches,
    log,
    logLimit,
    conflictFiles,
    rebaseStatus,
    diffResults,
    diffTitle,
    diffVisible,
    loading,
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
    statusColor,
  };
});
