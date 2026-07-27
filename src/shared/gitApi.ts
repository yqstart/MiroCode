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
): Promise<void> {
  return invoke("git_commit", { root, message, paths });
}

export async function gitBranches(root: string): Promise<GitBranchInfo[]> {
  return invoke("git_branches", { root });
}

export async function gitCheckout(root: string, name: string): Promise<void> {
  return invoke("git_checkout", { root, name });
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

export async function gitPull(root: string): Promise<string> {
  return invoke("git_pull", { root });
}

export async function gitPush(root: string, force?: boolean): Promise<string> {
  return invoke("git_push", { root, force });
}

export async function gitStash(root: string, message?: string): Promise<void> {
  return invoke("git_stash", { root, message });
}

export async function gitStashPop(root: string): Promise<void> {
  return invoke("git_stash_pop", { root });
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
