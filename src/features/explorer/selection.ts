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

/**
 * 右键资源树节点时的目标集合：
 * - 右键已选中的节点，保留整个当前选择；
 * - 右键未选中的节点，切换为该节点的单选。
 */
export function getContextSelectionPaths(
  selectedPaths: readonly string[],
  contextPath: string,
): string[] {
  return selectedPaths.includes(contextPath)
    ? [...selectedPaths]
    : [contextPath];
}

function normalizeSelectionPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function isSameOrDescendantPath(parent: string, target: string): boolean {
  const normalizedParent = normalizeSelectionPath(parent);
  const normalizedTarget = normalizeSelectionPath(target);
  return (
    normalizedTarget === normalizedParent ||
    normalizedTarget.startsWith(`${normalizedParent}/`)
  );
}

/**
 * 删除等批量操作只保留最上层路径，避免同时选中目录及其子项时重复操作。
 */
export function getTopLevelSelectionPaths(paths: readonly string[]): string[] {
  const uniquePaths = [...new Set(paths)];
  return uniquePaths.filter(
    (path) =>
      !uniquePaths.some(
        (candidate) =>
          candidate !== path && isSameOrDescendantPath(candidate, path),
      ),
  );
}
