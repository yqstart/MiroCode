import { invoke } from "@tauri-apps/api/core";

export interface GitStatusEntry {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
}

export interface GitStatusSnapshot {
  initialized: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
  conflictCount: number;
}

export interface GitBranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
}

export interface GitCommitInfo {
  id: string;
  summary: string;
  author: string;
  time: string;
  files: string[];
  parents: string[];
  refs: string[];
  unpushed: boolean;
}

export interface GitDiffResult {
  path: string;
  patch: string;
}

export type ConflictStrategy = "ours" | "theirs" | "manual";

export async function gitStatus(root: string): Promise<GitStatusSnapshot> {
  return invoke("git_status", { root });
}

export async function gitInit(root: string): Promise<void> {
  return invoke("git_init", { root });
}

export async function gitSetRemote(
  root: string,
  name: string,
  url: string,
): Promise<void> {
  return invoke("git_set_remote", { root, name, url });
}

export async function gitStage(root: string, paths: string[]): Promise<void> {
  return invoke("git_stage", { root, paths });
}

export async function gitUnstage(root: string, paths: string[]): Promise<void> {
  return invoke("git_unstage", { root, paths });
}

export async function gitCommit(
  root: string,
  message: string,
  paths?: string[],
  amend?: boolean,
): Promise<void> {
  return invoke("git_commit", {
    root,
    message,
    paths,
    amend: amend ?? false,
  });
}

export async function gitBranches(root: string): Promise<GitBranchInfo[]> {
  return invoke("git_branches", { root });
}

export async function gitCheckout(
  root: string,
  name: string,
  force?: boolean,
): Promise<void> {
  return invoke("git_checkout", { root, name, force: force ?? false });
}

export async function gitCreateBranch(
  root: string,
  name: string,
  checkout: boolean,
): Promise<void> {
  return invoke("git_create_branch", { root, name, checkout });
}

export async function gitDeleteBranch(root: string, name: string): Promise<void> {
  return invoke("git_delete_branch", { root, name });
}

export async function gitRenameBranch(
  root: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke("git_rename_branch", { root, from, to });
}

export async function gitLog(
  root: string,
  limit?: number,
): Promise<GitCommitInfo[]> {
  return invoke("git_log", { root, limit });
}

export async function gitDiff(
  root: string,
  path?: string,
  staged?: boolean,
): Promise<GitDiffResult> {
  return invoke("git_diff", { root, path, staged });
}

export interface GitFileSides {
  path: string;
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}

export interface GitConflictSides {
  path: string;
  base: string;
  ours: string;
  theirs: string;
  working: string;
}

export async function gitFileSides(
  root: string,
  path: string,
  staged?: boolean,
): Promise<GitFileSides> {
  return invoke("git_file_sides", { root, path, staged });
}

export async function gitConflictSides(
  root: string,
  path: string,
): Promise<GitConflictSides> {
  return invoke("git_conflict_sides", { root, path });
}

export async function gitPull(
  root: string,
  auth?: { username: string; password: string; remember?: boolean },
): Promise<string> {
  return invoke("git_pull", {
    root,
    username: auth?.username ?? null,
    password: auth?.password ?? null,
    remember: auth?.remember ?? null,
  });
}

export async function gitPush(
  root: string,
  force?: boolean,
  auth?: { username: string; password: string; remember?: boolean },
): Promise<string> {
  return invoke("git_push", {
    root,
    force: force ?? false,
    username: auth?.username ?? null,
    password: auth?.password ?? null,
    remember: auth?.remember ?? null,
  });
}

export async function gitStash(
  root: string,
  message?: string,
  includeUntracked?: boolean,
): Promise<void> {
  return invoke("git_stash", {
    root,
    message,
    includeUntracked: includeUntracked ?? false,
  });
}

export interface GitStashEntry {
  index: number;
  id: string;
  message: string;
}

export async function gitStashList(root: string): Promise<GitStashEntry[]> {
  return invoke("git_stash_list", { root });
}

export async function gitStashPop(root: string, index?: number): Promise<void> {
  return invoke("git_stash_pop", { root, index: index ?? null });
}

export async function gitStashApply(root: string, index: number): Promise<void> {
  return invoke("git_stash_apply", { root, index });
}

export async function gitStashDrop(root: string, index: number): Promise<void> {
  return invoke("git_stash_drop", { root, index });
}

export async function gitDiscardPaths(
  root: string,
  paths: string[],
): Promise<void> {
  return invoke("git_discard_paths", { root, paths });
}

export async function gitResetHard(root: string): Promise<void> {
  return invoke("git_reset_hard", { root });
}

export async function gitUndoCommit(root: string): Promise<void> {
  return invoke("git_undo_commit", { root });
}

export async function gitRevertTo(root: string, commitId: string): Promise<void> {
  return invoke("git_revert_to", { root, commitId });
}

export async function gitMergeBranch(root: string, name: string): Promise<string> {
  return invoke("git_merge_branch", { root, name });
}

export async function gitConflictFiles(root: string): Promise<string[]> {
  return invoke("git_conflict_files", { root });
}

export async function gitResolveConflict(
  root: string,
  path: string,
  strategy: ConflictStrategy,
): Promise<void> {
  return invoke("git_resolve_conflict", { root, path, strategy });
}

export interface GitRemoteInfo {
  name: string;
  url: string | null;
}

export interface GitBlameLine {
  line: number;
  commitId: string;
  author: string;
  time: string;
  summary: string;
}

export type GitAuthPayload = {
  username: string;
  password: string;
  remember?: boolean;
};

/** 查 Miro Code 已记住的 HTTPS 用户名（按远程 host） */
export async function gitStoredUsername(url: string): Promise<string | null> {
  return invoke("git_stored_username", { url });
}

export async function gitFetch(
  root: string,
  remote?: string,
  auth?: GitAuthPayload,
): Promise<string> {
  return invoke("git_fetch", {
    root,
    remote: remote ?? null,
    username: auth?.username ?? null,
    password: auth?.password ?? null,
    remember: auth?.remember ?? null,
  });
}

export async function gitUpdateProject(
  root: string,
  strategy: "merge" | "rebase",
  auth?: GitAuthPayload,
): Promise<string> {
  return invoke("git_update_project", {
    root,
    strategy,
    username: auth?.username ?? null,
    password: auth?.password ?? null,
    remember: auth?.remember ?? null,
  });
}

export async function gitRebaseBranch(root: string, onto: string): Promise<string> {
  return invoke("git_rebase_branch", { root, onto });
}

export interface GitRebaseStatus {
  inProgress: boolean;
  kind: string;
  headName: string | null;
  onto: string | null;
  conflicted: boolean;
}

export type GitRebaseAction = "pick" | "reword" | "squash" | "fix" | "drop";

export interface GitRebaseStep {
  action: GitRebaseAction | string;
  commitId: string;
  message?: string | null;
}

export async function gitRebaseStatus(root: string): Promise<GitRebaseStatus> {
  return invoke("git_rebase_status", { root });
}

export async function gitRebaseContinue(root: string): Promise<string> {
  return invoke("git_rebase_continue", { root });
}

export async function gitRebaseAbort(root: string): Promise<string> {
  return invoke("git_rebase_abort", { root });
}

export async function gitRebaseSkip(root: string): Promise<string> {
  return invoke("git_rebase_skip", { root });
}

export async function gitRebasePlan(
  root: string,
  onto: string,
): Promise<GitCommitInfo[]> {
  return invoke("git_rebase_plan", { root, onto });
}

export async function gitRebaseInteractive(
  root: string,
  onto: string,
  steps: GitRebaseStep[],
): Promise<string> {
  return invoke("git_rebase_interactive", { root, onto, steps });
}

export async function gitCherryPick(root: string, commitId: string): Promise<string> {
  return invoke("git_cherry_pick", { root, commitId });
}

export async function gitReset(
  root: string,
  commitId: string,
  mode: "soft" | "mixed" | "hard",
): Promise<string> {
  return invoke("git_reset", { root, commitId, mode });
}

export async function gitBlame(root: string, path: string): Promise<GitBlameLine[]> {
  return invoke("git_blame", { root, path });
}

export async function gitRemotes(root: string): Promise<GitRemoteInfo[]> {
  return invoke("git_remotes", { root });
}

export async function gitUnpushedCommits(
  root: string,
  limit?: number,
): Promise<GitCommitInfo[]> {
  return invoke("git_unpushed_commits", { root, limit });
}

export async function gitSetUpstream(
  root: string,
  branch: string,
  upstream: string,
): Promise<void> {
  return invoke("git_set_upstream", { root, branch, upstream });
}

export async function gitCheckoutRemote(
  root: string,
  remoteRef: string,
  localName?: string,
): Promise<string> {
  return invoke("git_checkout_remote", {
    root,
    remoteRef,
    localName: localName ?? null,
  });
}

export async function gitRevertCommit(
  root: string,
  commitId: string,
): Promise<string> {
  return invoke("git_revert_commit", { root, commitId });
}

export async function gitCreateBranchAt(
  root: string,
  name: string,
  commitId: string,
  checkout: boolean,
): Promise<void> {
  return invoke("git_create_branch_at", { root, name, commitId, checkout });
}

export async function gitCheckoutCommit(
  root: string,
  commitId: string,
): Promise<string> {
  return invoke("git_checkout_commit", { root, commitId });
}

export async function gitDeleteRemoteBranch(
  root: string,
  remoteRef: string,
): Promise<string> {
  return invoke("git_delete_remote_branch", { root, remoteRef });
}

export async function gitBranchSides(
  root: string,
  leftRef: string,
  rightRef: string,
  path?: string,
): Promise<GitFileSides> {
  return invoke("git_branch_sides", {
    root,
    leftRef,
    rightRef,
    path: path ?? null,
  });
}
