// ==================== Rename Symbol ====================
// JS/TS 优先使用 TypeScript LanguageService 的精确引用位置；Vue script 段
// 使用等长虚拟 TS 文件映射，其他语言/模板场景保留轻量索引兜底。

import type { EditorView } from "@codemirror/view";
import { findReferences, type ReferenceLocation } from "@/features/editor/findReferences";
import { wordAt } from "@/features/editor/documentSymbols";
import { workspaceSymbols } from "@/features/editor/workspaceSymbols";
import { readTextFile, writeTextFile } from "@/shared/fs";
import { useEditorStore } from "@/stores/editor";
import { useWorkspaceStore } from "@/stores/workspace";

const WORD_RE = /^[A-Za-z_$][\w$]*$/;

function lineColumnToOffset(text: string, line: number, column: number): number | null {
  if (line < 1 || column < 1) return null;
  let lineStart = 0;
  let currentLine = 1;
  while (currentLine < line) {
    const next = text.indexOf("\n", lineStart);
    if (next < 0) return null;
    lineStart = next + 1;
    currentLine += 1;
  }
  const offset = lineStart + column - 1;
  return offset <= text.length ? offset : null;
}

function applyEditsInView(
  view: EditorView,
  edits: Array<{ from: number; to: number; insert: string }>,
): void {
  if (!edits.length) return;
  view.dispatch({
    changes: [...edits].sort((a, b) => b.from - a.from),
    userEvent: "rename.symbol",
  });
}

async function loadFileContent(
  root: string,
  path: string,
  editorStore: ReturnType<typeof useEditorStore>,
): Promise<string | null> {
  const tab = editorStore.tabs.find((item) => item.path === path);
  if (tab) return tab.content;
  try {
    return await readTextFile(root, path);
  } catch {
    return null;
  }
}

function buildReplacement(
  content: string,
  refs: ReferenceLocation[],
  oldName: string,
  newName: string,
): Array<{ from: number; to: number; insert: string }> {
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  for (const ref of refs) {
    const from = lineColumnToOffset(content, ref.line, ref.column);
    if (from === null || content.slice(from, from + oldName.length) !== oldName) continue;
    edits.push({ from, to: from + oldName.length, insert: newName });
  }
  return edits;
}

/** 主入口：跨文件语义重命名；返回替换处数，cancelled 表示取消/无效输入。 */
export async function renameSymbol(
  view: EditorView,
  newName: string,
  root: string,
  sourceFile: string,
): Promise<{ replaced: number; cancelled: boolean }> {
  if (!WORD_RE.test(newName)) {
    useWorkspaceStore().showNotice("符号名只能包含字母、数字、下划线或 $", 2600);
    return { replaced: 0, cancelled: true };
  }
  const sourceContent = view.state.doc.toString();
  const pos = view.state.selection.main.head;
  const hit = wordAt(sourceContent, pos);
  if (!hit || hit.word === newName) return { replaced: 0, cancelled: true };

  const editorStore = useEditorStore();
  const workspace = useWorkspaceStore();
  const isWorkspaceCurrent = () =>
    workspace.rootPath === root && view.dom.isConnected;
  const isSourceUnchanged = () => view.state.doc.toString() === sourceContent;
  const refs = await findReferences(hit.word, sourceFile, sourceContent, root, {
    position: pos,
    maxDepth: 8,
    forRename: true,
  });
  if (!isWorkspaceCurrent() || !isSourceUnchanged()) {
    return { replaced: 0, cancelled: true };
  }
  if (!refs.length) {
    workspace.showNotice(`未找到「${hit.word}」的可重命名引用`, 2600);
    return { replaced: 0, cancelled: false };
  }

  const byFile = new Map<string, ReferenceLocation[]>();
  for (const ref of refs) {
    const list = byFile.get(ref.path) ?? [];
    list.push(ref);
    byFile.set(ref.path, list);
  }
  const previewFiles = [...byFile.keys()].map((path) => path.split(/[/\\]/).pop() ?? path);
  if (
    !window.confirm(
      `将把「${hit.word}」重命名为「${newName}」，影响 ${refs.length} 处、${byFile.size} 个文件。\n\n${previewFiles.join("\n")}\n\n继续？`,
    )
  ) {
    return { replaced: 0, cancelled: true };
  }
  if (!isWorkspaceCurrent() || !isSourceUnchanged()) {
    return { replaced: 0, cancelled: true };
  }

  const editedOpenFiles = new Set<string>();
  const filesToWrite = new Map<string, { before: string; next: string }>();
  const openFilePlans = new Map<string, { before: string; next: string }>();
  const replacementCounts = new Map<string, number>();
  const appliedFiles = new Set<string>();
  let totalReplaced = 0;

  // 先只计算所有文件的替换结果，等快照校验通过后再真正修改编辑器/磁盘。
  const sourceRefs = byFile.get(sourceFile) ?? [];
  const sourceEdits = buildReplacement(sourceContent, sourceRefs, hit.word, newName);
  if (sourceEdits.length) replacementCounts.set(sourceFile, sourceEdits.length);

  for (const [file, fileRefs] of byFile) {
    if (!isWorkspaceCurrent() || !isSourceUnchanged()) {
      return { replaced: 0, cancelled: true };
    }
    if (file === sourceFile) continue;
    const content = await loadFileContent(root, file, editorStore);
    if (!isWorkspaceCurrent() || !isSourceUnchanged()) {
      return { replaced: 0, cancelled: true };
    }
    if (content === null) continue;
    const edits = buildReplacement(content, fileRefs, hit.word, newName);
    if (!edits.length) continue;
    const sorted = [...edits].sort((a, b) => b.from - a.from);
    let next = content;
    for (const edit of sorted) {
      next = next.slice(0, edit.from) + edit.insert + next.slice(edit.to);
    }
    replacementCounts.set(file, edits.length);
    const tab = editorStore.tabs.find((item) => item.path === file);
    if (tab) {
      // 文件可能在读取期间被打开并被用户修改；此时不能用旧快照覆盖用户输入。
      if (tab.content !== content) return { replaced: 0, cancelled: true };
      openFilePlans.set(file, { before: content, next });
    } else {
      filesToWrite.set(file, { before: content, next });
    }
  }

  if (!isWorkspaceCurrent() || !isSourceUnchanged()) {
    return { replaced: 0, cancelled: true };
  }
  for (const [file, plan] of openFilePlans) {
    const tab = editorStore.tabs.find((item) => item.path === file);
    if (!tab || tab.content !== plan.before) {
      return { replaced: 0, cancelled: true };
    }
  }
  // 未打开文件也必须在真正修改编辑器前重新核对磁盘快照；规划期间若有
  // 外部进程改过文件，直接写入 next 会覆盖用户的新内容。
  for (const [file, plan] of filesToWrite) {
    if (!isWorkspaceCurrent() || !isSourceUnchanged()) {
      return { replaced: 0, cancelled: true };
    }
    let current: string;
    try {
      current = await readTextFile(root, file);
    } catch {
      workspace.showNotice(`无法确认 ${file} 的最新内容，重命名已取消`, 3600);
      return { replaced: 0, cancelled: true };
    }
    if (current !== plan.before) {
      workspace.showNotice(`「${file}」在重命名期间已被修改，重命名已取消`, 3600);
      return { replaced: 0, cancelled: true };
    }
  }

  // 当前视图直接 dispatch，保留 CodeMirror 历史/选区语义。
  applyEditsInView(view, sourceEdits);
  if (sourceEdits.length) {
    totalReplaced += sourceEdits.length;
    appliedFiles.add(sourceFile);
    editedOpenFiles.add(sourceFile);
  }
  for (const [file, plan] of openFilePlans) {
    editorStore.markExternalUpdate(file);
    editorStore.setContent(file, plan.next);
    totalReplaced += replacementCounts.get(file) ?? 0;
    appliedFiles.add(file);
    editedOpenFiles.add(file);
  }
  const sourceAfterRename = view.state.doc.toString();
  const isSourceAfterRenameCurrent = () =>
    isWorkspaceCurrent() && view.state.doc.toString() === sourceAfterRename;

  // 未打开文件直接写盘，不再要求用户手动逐个打开；打开标签只保存本次编辑的文件。
  for (const [file, plan] of filesToWrite) {
    if (!isSourceAfterRenameCurrent()) return { replaced: 0, cancelled: true };
    // 规划后文件可能在写入前被打开；若内容仍是规划快照，将其转入打开
    // 标签流程，避免磁盘版本和编辑器缓冲区分叉。
    const liveTab = editorStore.tabs.find((item) => item.path === file);
    if (liveTab) {
      if (liveTab.content !== plan.before) {
        workspace.showNotice(`「${file}」在重命名期间已被修改，已跳过写入`, 3600);
        continue;
      }
      editorStore.markExternalUpdate(file);
      editorStore.setContent(file, plan.next);
      totalReplaced += replacementCounts.get(file) ?? 0;
      appliedFiles.add(file);
      editedOpenFiles.add(file);
      continue;
    }
    try {
      const current = await readTextFile(root, file);
      if (!isSourceAfterRenameCurrent()) return { replaced: 0, cancelled: true };
      if (current !== plan.before) {
        workspace.showNotice(`「${file}」在重命名期间已被修改，已跳过写入`, 3600);
        continue;
      }
      const openedDuringRead = editorStore.tabs.find((item) => item.path === file);
      if (openedDuringRead) {
        if (openedDuringRead.content !== current) {
          workspace.showNotice(`「${file}」在重命名期间已被修改，已跳过写入`, 3600);
          continue;
        }
        editorStore.markExternalUpdate(file);
        editorStore.setContent(file, plan.next);
        totalReplaced += replacementCounts.get(file) ?? 0;
        appliedFiles.add(file);
        editedOpenFiles.add(file);
        continue;
      }
      workspace.markSelfWrite(file);
      await writeTextFile(root, file, plan.next);
      totalReplaced += replacementCounts.get(file) ?? 0;
      appliedFiles.add(file);
      const openedDuringWrite = editorStore.tabs.find((item) => item.path === file);
      if (openedDuringWrite?.content === plan.before) {
        editorStore.markExternalUpdate(file);
        editorStore.setContent(file, plan.next);
        editedOpenFiles.add(file);
      }
    } catch (error) {
      workspace.showNotice(
        `写入 ${file} 失败：${error instanceof Error ? error.message : String(error)}`,
        3600,
      );
    }
  }

  for (const file of editedOpenFiles) {
    if (!isWorkspaceCurrent()) return { replaced: 0, cancelled: true };
    const tab = editorStore.tabs.find((item) => item.path === file);
    if (!tab) continue;
    try {
      workspace.markSelfWrite(file);
      const content = tab.content;
      await writeTextFile(root, file, content);
      if (!isWorkspaceCurrent()) return { replaced: 0, cancelled: true };
      if (tab.content !== content) continue;
      editorStore.syncFromDisk(file, tab.content);
    } catch (error) {
      workspace.showNotice(
        `写入 ${file} 失败：${error instanceof Error ? error.message : String(error)}`,
        3600,
      );
    }
  }

  for (const file of appliedFiles) {
    workspaceSymbols.invalidate(file);
  }
  if (totalReplaced > 0) {
    workspace.showNotice(
      `已重命名 ${hit.word} → ${newName}，共 ${totalReplaced} 处（${appliedFiles.size} 个文件）`,
      3200,
    );
  }
  return { replaced: totalReplaced, cancelled: false };
}
