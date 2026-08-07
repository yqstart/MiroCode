// ==================== Find References（LSP 简化版 v1） ====================
// 跨文件 find references：基于 workspaceSymbols.findAllReferences，
// 返回按文件+行排序的去重结果，供 UI 渲染 / rename 使用。
//
// 不带 UI 面板（v1 仅暴露 API + console 打印），降低首次集成面。
// 后续 v2 可挂到侧栏 ListPanel。

import { useEditorStore } from "@/stores/editor";
import { workspaceSymbols } from "@/features/editor/workspaceSymbols";

export interface ReferenceLocation {
  path: string;
  line: number;
  column: number;
}

/** 跨文件查找所有引用（默认 5 层深度） */
export async function findReferences(
  word: string,
  sourceFile: string,
  sourceContent: string,
  root: string,
  options: {
    maxDepth?: number;
    /** 找到后自动调 openInEditor 第一个结果 */
    autoOpenFirst?: boolean;
  } = {},
): Promise<ReferenceLocation[]> {
  const { maxDepth = 5, autoOpenFirst = false } = options;
  if (!word) return [];
  const refs = await workspaceSymbols.findAllReferences(root, word, sourceFile, sourceContent);
  void maxDepth; // 当前实现固定 5
  if (autoOpenFirst && refs.length > 0) {
    const first = refs[0];
    const editor = useEditorStore();
    void editor.openFileAt(first.path, first.line, first.column);
  }
  return refs;
}

/** 在 DevTools console 打印 + UI 弹条概要（用于 v1 快速闭环） */
export function logReferences(refs: ReferenceLocation[], word: string): void {
  if (refs.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[findReferences] 符号 "${word}" 未找到任何引用`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[findReferences] 符号 "${word}" 共 ${refs.length} 处引用：`);
  for (const r of refs) {
    // eslint-disable-next-line no-console
    console.log(`  ${r.path}:${r.line}:${r.column}`);
  }
}
