export interface GitLogCommitLike {
  id: string;
  parents?: string[];
}

/** 首选当前 HEAD；无法命中时退回最新提交。 */
export function preferredCommitId(
  commits: readonly GitLogCommitLike[],
  head: string | null | undefined,
): string | null {
  if (head) {
    const match = commits.find(
      (commit) => commit.id === head || commit.id.startsWith(head) || head.startsWith(commit.id),
    );
    if (match) return match.id;
  }
  return commits[0]?.id ?? null;
}

/** 过滤后的日志只在可见提交中选择 HEAD / 最新提交，避免高亮落到隐藏行。 */
export function preferredVisibleCommitId(
  commits: readonly GitLogCommitLike[],
  visibleIds: readonly string[],
  head: string | null | undefined,
): string | null {
  const visible = new Set(visibleIds);
  const preferred = preferredCommitId(commits, head);
  if (preferred && visible.has(preferred)) return preferred;
  return commits.find((commit) => visible.has(commit.id))?.id ?? null;
}

export function parentCommitId(
  commits: readonly GitLogCommitLike[],
  selectedId: string,
): string | null {
  return commits.find((commit) => commit.id === selectedId)?.parents?.[0] ?? null;
}

export function childCommitId(
  commits: readonly GitLogCommitLike[],
  selectedId: string,
): string | null {
  return commits.find((commit) => commit.parents?.includes(selectedId))?.id ?? null;
}
