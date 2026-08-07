// ==================== Rename Symbol（LSP 简化版 v1） ====================
// 跨文件 rename symbol：基于 findReferences + 编辑器 StateEffect。
// 流程：
// 1. 光标落在 word 上 → 调 findReferences
// 2. 按行倒序替换（避免行号偏移）
// 3. 替换完成后 saveAll
// 4. 刷新工作区符号缓存
//
// F2 键触发；冲突防护：单词必须匹配 [A-Za-z_$][\w$]*

import type { EditorView } from "@codemirror/view";
import { workspaceSymbols } from "@/features/editor/workspaceSymbols";
import { findReferences, type ReferenceLocation } from "@/features/editor/findReferences";
import { wordAt } from "@/features/editor/documentSymbols";
import { useEditorStore } from "@/stores/editor";
import { useWorkspaceStore } from "@/stores/workspace";

const WORD_RE = /^[A-Za-z_$][\w$]*$/;

/** CodeMirror 视图内按行倒序替换 */
function applyEditsInView(
  view: EditorView,
  edits: Array<{ from: number; to: number; insert: string }>,
): void {
  if (edits.length === 0) return;
  // 按 from 倒序，CodeMirror dispatch 单次事务
  const sorted = [...edits].sort((a, b) => b.from - a.from);
  view.dispatch({
    changes: sorted,
    userEvent: "rename.symbol",
  });
}

/** 加载文件内容（优先用编辑器中已打开的版本） */
function getFileContent(
  editorStore: ReturnType<typeof useEditorStore>,
  path: string,
): string | null {
  const tab = editorStore.tabs.find((t) => t.path === path);
  return tab?.content ?? null;
}

/** 主入口：执行 rename。返回替换处数；返回 -1 表示取消 / 错误 */
export async function renameSymbol(
  view: EditorView,
  newName: string,
  root: string,
  sourceFile: string,
): Promise<{ replaced: number; cancelled: boolean }> {
  if (!WORD_RE.test(newName)) {
    return { replaced: 0, cancelled: true };
  }
  const doc = view.state.doc.toString();
  const pos = view.state.selection.main.head;
  const hit = wordAt(doc, pos);
  if (!hit) return { replaced: 0, cancelled: true };

  const oldName = hit.word;
  if (oldName === newName) return { replaced: 0, cancelled: true };

  const editorStore = useEditorStore();

  // 1) 找全部引用（包括定义点）
  const refs = await findReferences(oldName, sourceFile, doc, root);

  // 2) 加载每个引用文件的最新内容
  const fileContents = new Map<string, string>();
  for (const r of refs) {
    if (fileContents.has(r.path)) continue;
    const content = getFileContent(editorStore, r.path);
    fileContents.set(r.path, content ?? "");
  }

  // 3) 按文件分组，按行倒序计算 edit
  const byFile = new Map<string, ReferenceLocation[]>();
  for (const r of refs) {
    const list = byFile.get(r.path) ?? [];
    list.push(r);
    byFile.set(r.path, list);
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => b.line - a.line || b.column - a.column);
  }

  // 4) 对每个文件构造替换 edit（offset 由 line/column + 行长度累加算出）
  let totalReplaced = 0;
  const editedFiles = new Set<string>();
  for (const [file, list] of byFile.entries()) {
    const text = fileContents.get(file) ?? "";
    const lines = text.split("\n");
    // 当前文件若是 editor 打开的：用 view.dispatch 直接改
    if (file === sourceFile) {
      const edits: Array<{ from: number; to: number; insert: string }> = [];
      for (const ref of list) {
        const lineIdx = ref.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) continue;
        const lineText = lines[lineIdx];
        // 列号 → 字符 index
        const colIdx = ref.column - 1;
        // 校验：from..to 必须是 oldName
        const slice = lineText.slice(colIdx, colIdx + oldName.length);
        if (slice !== oldName) continue;
        // 转为 view state offset：state.doc 的 line/column 与 lines 数组一致
        const fromPos = view.state.doc.line(ref.line).from + colIdx;
        const toPos = fromPos + oldName.length;
        edits.push({ from: fromPos, to: toPos, insert: newName });
        totalReplaced += 1;
      }
      applyEditsInView(view, edits);
      editedFiles.add(file);
    } else {
      // 其他文件：记下要替换的 (line, col) + 旧/新名
      // 真实写入留给 saveAll 阶段（用户必须先打开 / 已打开才会被替换）
      // v1 简化：仅处理当前已打开的标签页；其他文件跳过（提示用户打开）
      const tab = editorStore.tabs.find((t) => t.path === file);
      if (!tab) continue; // 跳过未打开
      // 在 tab.content 上做文本替换（按行倒序）
      const linesArr = tab.content.split("\n");
      const newLines = [...linesArr];
      let fileReplaced = 0;
      for (const ref of list) {
        const lineIdx = ref.line - 1;
        if (lineIdx < 0 || lineIdx >= linesArr.length) continue;
        const lineText = newLines[lineIdx];
        const colIdx = ref.column - 1;
        const slice = lineText.slice(colIdx, colIdx + oldName.length);
        if (slice !== oldName) continue;
        newLines[lineIdx] = lineText.slice(0, colIdx) + newName + lineText.slice(colIdx + oldName.length);
        fileReplaced += 1;
      }
      if (fileReplaced > 0) {
        const newContent = newLines.join("\n");
        // rename 是外部修改（非用户在 CM 内输入），标记后 watcher 才会同步到 CM
        editorStore.markExternalUpdate(file);
        editorStore.setContent(file, newContent);
        totalReplaced += fileReplaced;
        editedFiles.add(file);
      }
    }
  }

  // 5) 失效被编辑文件的缓存（避免索引与新内容不一致）
  for (const f of editedFiles) {
    workspaceSymbols.invalidate(f);
  }

  // 6) 保存所有被改动的文件
  if (editedFiles.size > 0) {
    await editorStore.saveAll({ quiet: true });
    const workspace = useWorkspaceStore();
    workspace.showNotice(
      `已重命名 ${oldName} → ${newName}，共 ${totalReplaced} 处（${editedFiles.size} 个文件）`,
      3000,
    );
  }
  return { replaced: totalReplaced, cancelled: false };
}
