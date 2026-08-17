import type { GitStatusEntry } from "@/shared/gitApi";

/**
 * 按「相对仓库根」路径逐级聚合目录内的 git 改动文件：
 * - 返回 Map：key 为相对目录路径（正斜杠，如 `src/features`），
 *   value 为该目录子树内改动文件数，以及遍历顺序中第一个改动文件的相对路径
 * - `a/b/c.ts` 会同时累加 `a/b` 与 `a` 两级，折叠的深层目录据此显示数量徽章
 * - 文件直接位于仓库根时无目录层级，跳过（根目录不显示徽章，文件本身可展开可见）
 * - 纯函数，不依赖 store，便于独立单测
 */
export function aggregateDirDirtyCounts(
  entries: GitStatusEntry[],
): Map<string, { count: number; first: string }> {
  const byDir = new Map<string, { count: number; first: string }>();
  for (const e of entries) {
    const rel = e.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const sep = rel.lastIndexOf("/");
    if (sep <= 0) continue;
    let dir = rel.slice(0, sep);
    while (dir.length > 0) {
      const rec = byDir.get(dir) ?? { count: 0, first: rel };
      rec.count += 1;
      byDir.set(dir, rec);
      const idx = dir.lastIndexOf("/");
      dir = idx > 0 ? dir.slice(0, idx) : "";
    }
  }
  return byDir;
}