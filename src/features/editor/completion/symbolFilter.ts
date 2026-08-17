// ==================== 跨文件符号补全过滤（纯函数） ====================
// workspaceSymbols.searchSymbols 的核心逻辑提取：前缀过滤 + 按定义质量排序。
// 零运行时依赖（仅 type import），便于 node --experimental-strip-types 直测。

import type { DocumentSymbol, SymbolKind } from "@/features/editor/documentSymbols";

export type IndexedSymbol = DocumentSymbol & { path: string };

/** 候选排序：更可能是定义的类型优先（function/class/interface/type 优先于 variable） */
export function rankSymbolCandidates(
  list: IndexedSymbol[],
): IndexedSymbol[] {
  const priority: Record<SymbolKind, number> = {
    function: 0,
    class: 1,
    interface: 2,
    type: 3,
    method: 4,
    enum: 5,
    variable: 6,
  };
  return [...list].sort((a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99));
}

/**
 * 从符号聚合表（name → 跨文件候选）按前缀挑最佳候选
 *
 * @param index 符号聚合表（与 workspaceSymbols.globalIndex 同构）
 * @param prefix 用户已输入的前缀（大小写不敏感匹配）
 * @param limit 返回上限
 */
export function pickBestSymbols(
  index: Map<string, IndexedSymbol[]>,
  prefix: string,
  limit = 16,
): Array<{ name: string; kind: SymbolKind; path: string; line: number }> {
  if (!prefix) return [];
  const lower = prefix.toLowerCase();
  const out: Array<{ name: string; kind: SymbolKind; path: string; line: number }> = [];
  for (const [name, list] of index.entries()) {
    if (!name.toLowerCase().startsWith(lower)) continue;
    const best = rankSymbolCandidates(list)[0];
    if (!best) continue;
    out.push({ name, kind: best.kind, path: best.path, line: best.line });
    if (out.length >= limit) break;
  }
  return out;
}
