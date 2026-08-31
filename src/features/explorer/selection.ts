/**
 * 返回资源树中锚点与目标之间的连续路径。
 * 锚点或目标不在当前可见节点中时，退化为只选择目标。
 */
export function getPathRange(
  visiblePaths: readonly string[],
  anchorPath: string | null,
  targetPath: string,
): string[] {
  if (!anchorPath) return [targetPath];

  const anchorIndex = visiblePaths.indexOf(anchorPath);
  const targetIndex = visiblePaths.indexOf(targetPath);
  if (anchorIndex < 0 || targetIndex < 0) return [targetPath];

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visiblePaths.slice(start, end + 1);
}
