import type { FileSearchHit } from "@/shared/searchApi";

export interface ParsedQuickOpenQuery {
  searchText: string;
  line: number | null;
  column: number;
}

/** 支持 `文件名:行` 与 `文件名:行:列`，保留 Windows 盘符中的冒号。 */
export function parseQuickOpenQuery(raw: string): ParsedQuickOpenQuery {
  const value = raw.trim();
  const match = value.match(/^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/);
  if (!match) return { searchText: value, line: null, column: 1 };
  return {
    searchText: match[1].trim(),
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : 1,
  };
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** 同分结果优先最近访问文件，使常见的 index.vue 搜索不再只按路径字母排序。 */
export function rankQuickOpenResults(
  results: readonly FileSearchHit[],
  recentPaths: readonly string[],
): FileSearchHit[] {
  const recentRank = new Map(
    recentPaths.map((path, index) => [normalizedPath(path), index]),
  );
  return [...results].sort((left, right) => {
    const leftRecent = recentRank.get(normalizedPath(left.path));
    const rightRecent = recentRank.get(normalizedPath(right.path));
    const leftScore = left.score + (leftRecent === undefined ? 0 : 120 - Math.min(100, leftRecent * 4));
    const rightScore = right.score + (rightRecent === undefined ? 0 : 120 - Math.min(100, rightRecent * 4));
    return rightScore - leftScore || left.relative.localeCompare(right.relative);
  });
}
