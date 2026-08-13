/**
 * LSP CodeMirror 6 扩展：7 项能力桥接
 *
 * 能力清单：
 * 1. hover tooltip        - textDocument/hover
 * 2. 签名帮助             - textDocument/signatureHelp
 * 3. 语义补全             - textDocument/completion（合并到现有 completions.ts）
 * 4. 类型诊断             - textDocument/publishDiagnostics（合流到 setDiagnostics）
 * 5. 定义跳转             - textDocument/definition（LSP 可用时替换 v1 正则）
 * 6. 引用查找             - textDocument/references（Shift+F12）
 * 7. 重命名               - textDocument/rename（F2，替换 v1 正则）
 *
 * 降级策略：每个能力内部检查 lspManager.isAvailable()，
 * 不可用时降级回 v1 对应实现。
 */

import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { type Extension, Prec } from "@codemirror/state";
import {
  hoverTooltip,
  keymap,
  type EditorView,
  Tooltip,
} from "@codemirror/view";
import { marked } from "marked";
import { lspManager } from "./manager";
import { uriToPath } from "./client";
import { findTargetAtPosAsync } from "@/features/editor/navigation";
import { findReferences } from "@/features/editor/findReferences";
import { renameSymbol } from "@/features/editor/renameSymbol";
import { sourcesForPath } from "@/features/editor/completions";

// ==================== 辅助函数 ====================

/** CodeMirror 偏移量 -> LSP position {line, character} */
function offsetToLspPosition(view: EditorView, offset: number): { line: number; character: number } {
  const doc = view.state.doc;
  const lineObj = doc.lineAt(offset);
  return {
    line: lineObj.number - 1, // LSP 0-based
    character: offset - lineObj.from,
  };
}

/** LSP position -> CodeMirror 偏移量 */
function lspPositionToOffset(view: EditorView, line: number, character: number): number {
  const doc = view.state.doc;
  const clampedLine = Math.max(1, Math.min(line + 1, doc.lines)); // LSP 0-based -> CM 1-based
  const lineObj = doc.line(clampedLine);
  return lineObj.from + Math.min(character, lineObj.length);
}

/** LSP severity -> CM Diagnostic severity */
function lspSeverityToCm(severity: number | undefined): "error" | "warning" | "info" {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    default:
      return "info";
  }
}

/** LSP Location/Location[] -> {path, line, character} */
interface LocationInfo {
  path: string;
  line: number;
  character: number;
}

function parseLocation(loc: unknown): LocationInfo | null {
  if (!loc || typeof loc !== "object") return null;
  const obj = loc as { uri?: string; range?: { start?: { line?: number; character?: number } } };
  if (!obj.uri || !obj.range?.start) return null;
  return {
    path: uriToPath(obj.uri),
    line: obj.range.start.line ?? 0,
    character: obj.range.start.character ?? 0,
  };
}

function parseLocationList(loc: unknown): LocationInfo[] {
  if (Array.isArray(loc)) {
    return loc.map(parseLocation).filter((l): l is LocationInfo => l !== null);
  }
  const single = parseLocation(loc);
  return single ? [single] : [];
}

// ==================== 1. Hover Tooltip ====================

/** hover tooltip 扩展 */
function createHoverExtension(filePath: string): Extension {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    if (!lspManager.isAvailable()) return null;
    const { line, character } = offsetToLspPosition(view, pos);
    try {
      const result = await lspManager.hover(filePath, line, character);
      if (!result) return null;

      const hover = result as {
        contents?:
          | string
          | { kind?: string; value?: string }
          | Array<{ language?: string; value?: string }>;
        range?: { start: { line: number; character: number }; end: { line: number; character: number } };
      };
      if (!hover.contents) return null;

      const html = renderHoverContents(hover.contents);
      if (!html) return null;

      const range = hover.range;
      const from = range
        ? lspPositionToOffset(view, range.start.line, range.start.character)
        : pos;
      const to = range
        ? lspPositionToOffset(view, range.end.line, range.end.character)
        : pos;

      return {
        pos: from,
        end: to,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-hover-content";
          dom.innerHTML = html;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });
}

/** 渲染 hover 内容（支持 MarkupContent / MarkedString / MarkedString[]） */
function renderHoverContents(
  contents: string | { kind?: string; value?: string } | Array<{ language?: string; value?: string }>,
): string | null {
  if (typeof contents === "string") {
    return marked.parse(contents) as string;
  }
  if (Array.isArray(contents)) {
    return contents
      .map((item) => {
        if (typeof item === "string") return marked.parse(item) as string;
        if (item.language) {
          return `<pre><code>${escapeHtml(item.value ?? "")}</code></pre>`;
        }
        return marked.parse(item.value ?? "") as string;
      })
      .join("");
  }
  // MarkupContent { kind, value }
  if (contents.kind === "markdown") {
    return marked.parse(contents.value ?? "") as string;
  }
  // plaintext
  return `<p>${escapeHtml(contents.value ?? "")}</p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ==================== 2. 签名帮助 ====================

/** 签名帮助 tooltip（基于触发字符） */
function createSignatureHelpExtension(filePath: string): Extension {
  // 签名触发字符
  const triggerChars = new Set(["(", ",", "<"]);

  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    if (!lspManager.isAvailable()) return null;

    // 检查光标前一个字符是否是触发字符
    const before = view.state.doc.slice(Math.max(0, pos - 1), pos).toString();
    if (!triggerChars.has(before)) {
      // 也可检查当前是否在括号内（简单启发式）
      const textBefore = view.state.doc.slice(0, pos).toString();
      const lastOpen = textBefore.lastIndexOf("(");
      const lastClose = textBefore.lastIndexOf(")");
      if (lastOpen < lastClose) return null; // 不在括号内
    }

    const { line, character } = offsetToLspPosition(view, pos);
    try {
      const result = await lspManager.signatureHelp(filePath, line, character);
      if (!result) return null;

      const sigHelp = result as {
        signatures?: Array<{
          label?: string;
          documentation?: string | { value?: string };
          parameters?: Array<{
            label?: string | [number, number];
            documentation?: string | { value?: string };
          }>;
        }>;
        activeSignature?: number;
        activeParameter?: number;
      };
      if (!sigHelp.signatures?.length) return null;

      const html = renderSignatureHelp(sigHelp);
      if (!html) return null;

      return {
        pos,
        end: pos,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-sig-content";
          dom.innerHTML = html;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });
}

function renderSignatureHelp(sigHelp: {
  signatures?: Array<{
    label?: string;
    documentation?: string | { value?: string };
    parameters?: Array<{
      label?: string | [number, number];
      documentation?: string | { value?: string };
    }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}): string | null {
  const sigs = sigHelp.signatures ?? [];
  if (sigs.length === 0) return null;
  const activeSig = sigHelp.activeSignature ?? 0;
  const activeParam = sigHelp.activeParameter ?? 0;

  const sig = sigs[activeSig];
  if (!sig?.label) return null;

  let label = sig.label;
  // 高亮当前参数（如果是 [start, end] 形式）
  if (sig.parameters && sig.parameters[activeParam]) {
    const paramLabel = sig.parameters[activeParam].label;
    if (Array.isArray(paramLabel)) {
      const [start, end] = paramLabel;
      label =
        label.slice(0, start) +
        '<span class="cm-sig-active">' +
        escapeHtml(label.slice(start, end)) +
        "</span>" +
        label.slice(end);
    }
  }

  let html = `<div class="cm-sig-label">${escapeHtml(label)}</div>`;
  if (sig.documentation) {
    const doc = typeof sig.documentation === "string"
      ? sig.documentation
      : sig.documentation.value ?? "";
    if (doc) html += `<div class="cm-sig-doc">${marked.parse(doc) as string}</div>`;
  }
  return html;
}

// ==================== 3. 语义补全 ====================

/** LSP 补全 source（合并到现有 completions.ts 的 source 列表） */
export function createLspCompletionSource(filePath: string) {
  return async function lspCompletion(
    context: CompletionContext,
  ): Promise<CompletionResult | null> {
    if (!lspManager.isAvailable()) return null;

    // 获取当前补全位置
    const pos = context.pos;
    const view = context.view;
    if (!view) return null;

    const { line, character } = offsetToLspPosition(view, pos);

    try {
      const result = await lspManager.completion(filePath, line, character);
      if (!result) return null;

      // CompletionList 或 CompletionItem[]
      const items = Array.isArray(result)
        ? result
        : (result as { items?: unknown[] }).items ?? [];

      if (!Array.isArray(items) || items.length === 0) return null;

      const lspItems = items as Array<{
        label: string;
        kind?: number;
        detail?: string;
        documentation?: string | { value?: string };
        insertText?: string;
        insertTextFormat?: number;
      }>;

      // 查找当前单词起始位置
      const word = context.matchBefore(/[\w$]+/);
      const from = word ? word.from : pos;

      return {
        from,
        to: pos,
        options: lspItems.map((item) => ({
          label: item.label,
          type: lspCompletionKindToCm(item.kind),
          detail: item.detail,
          info: typeof item.documentation === "string"
            ? item.documentation
            : item.documentation?.value,
          apply: item.insertText && item.insertTextFormat === 2
            ? item.insertText // snippet
            : item.insertText ?? item.label,
        })),
        validFor: /^[\w$]*$/,
      };
    } catch {
      return null;
    }
  };
}

/** LSP CompletionItemKind -> CM Completion type */
function lspCompletionKindToCm(kind?: number): string | undefined {
  switch (kind) {
    case 1: // Text
    case 9: // Module
    case 10: // Class
    case 21: // Struct
      return "type";
    case 2: // Method
    case 3: // Function
    case 6: // Variable
      return "variable";
    case 4: // Constructor
    case 5: // Field
    case 7: // Class
      return "property";
    case 8: // Interface
    case 11: // Enum
    case 13: // EnumMember
      return "type";
    case 14: // Keyword
      return "keyword";
    case 15: // Snippet
      return "namespace";
    case 12: // File
      return "namespace";
    default:
      return undefined;
  }
}

// ==================== 4. 类型诊断 ====================

/** 诊断合流器：当前仅消费 LSP 诊断（ESLint 链路已移除） */
export interface DiagnosticsMerger {
  /** 设置 LSP 诊断 */
  setLspDiagnostics(view: EditorView, uri: string, diagnostics: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    severity?: number;
    message?: string;
    source?: string;
  }>): void;
}

/** 创建诊断管理器（按文件维度缓存 LSP 诊断，setDiagnostics 到编辑器） */
export function createDiagnosticsManager(filePath: string): DiagnosticsMerger & { dispose: () => void } {
  let lspDiags: Diagnostic[] = [];

  function apply(view: EditorView) {
    const seen = new Set<string>();
    const merged: Diagnostic[] = [];
    for (const d of lspDiags) {
      const key = `${d.from}-${d.to}-${d.severity}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(d);
      }
    }
    view.dispatch(setDiagnostics(view.state, merged));
  }

  return {
    setLspDiagnostics(view, uri, diagnostics) {
      const path = uriToPath(uri);
      if (path !== filePath) return;

      lspDiags = diagnostics.map((d) => {
        const from = lspPositionToOffset(view, d.range.start.line, d.range.start.character);
        const to = lspPositionToOffset(view, d.range.end.line, d.range.end.character);
        return {
          from,
          to: Math.max(from, to),
          severity: lspSeverityToCm(d.severity),
          message: d.message ?? "LSP",
          source: d.source ?? "lsp",
        } satisfies Diagnostic;
      });
      apply(view);
    },
    dispose() {
      lspDiags = [];
    },
  };
}

// ==================== 5. 定义跳转（LSP 优先，降级回 v1） ====================

/** LSP go-to-definition（降级回 navigation.ts v1） */
export async function lspGoToDefinition(
  view: EditorView,
  filePath: string,
  onNavigate: (path: string, line: number, column: number) => void,
  workspaceRoot: string,
): Promise<boolean> {
  // LSP 可用时优先走 LSP
  if (lspManager.isAvailable()) {
    const pos = view.state.selection.main.head;
    const { line, character } = offsetToLspPosition(view, pos);
    try {
      const result = await lspManager.definition(filePath, line, character);
      const locations = parseLocationList(result);
      if (locations.length > 0) {
        const loc = locations[0];
        onNavigate(loc.path, loc.line + 1, loc.character + 1); // LSP 0-based -> 1-based
        return true;
      }
    } catch {
      // 降级回 v1
    }
  }

  // 降级回 v1 正则
  const doc = view.state.doc.toString();
  const pos = view.state.selection.main.head;
  const target = await findTargetAtPosAsync(doc, pos, workspaceRoot, filePath);
  if (target) {
    onNavigate(target.path, target.line, target.column);
  }
  return true;
}

// ==================== 6. 引用查找（Shift+F12） ====================

/** LSP find references（降级回 findReferences.ts v1） */
export async function lspFindReferences(
  view: EditorView,
  filePath: string,
  workspaceRoot: string,
): Promise<void> {
  if (lspManager.isAvailable()) {
    const pos = view.state.selection.main.head;
    const { line, character } = offsetToLspPosition(view, pos);
    try {
      const result = await lspManager.references(filePath, line, character);
      const locations = parseLocationList(result);
      if (locations.length > 0) {
        // v1 暂时只 console 打印；后续加 UI 面板
        console.log("[lsp] references:", locations);
        return;
      }
    } catch {
      // 降级回 v1
    }
  }

  // 降级回 v1
  const doc = view.state.doc.toString();
  const pos = view.state.selection.main.head;
  // 提取光标下的单词
  const word = extractWordAt(doc, pos);
  if (word) {
    void findReferences(word, filePath, doc, workspaceRoot, { autoOpenFirst: false });
  }
}

// ==================== 7. 重命名（F2，LSP 优先，降级回 v1） ====================

/** LSP rename（降级回 renameSymbol.ts v1） */
export async function lspRename(
  view: EditorView,
  filePath: string,
  workspaceRoot: string,
  newName: string,
): Promise<boolean> {
  if (lspManager.isAvailable()) {
    const pos = view.state.selection.main.head;
    const { line, character } = offsetToLspPosition(view, pos);
    try {
      const result = await lspManager.rename(filePath, line, character, newName);
      const workspaceEdit = result as {
        changes?: Record<string, Array<{
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          newText: string;
        }>>;
        documentChanges?: unknown[];
      };

      if (workspaceEdit?.changes) {
        // 应用所有文件变更
        await applyWorkspaceEdit(workspaceEdit.changes, workspaceRoot);
        return true;
      }
    } catch {
      // 降级回 v1
    }
  }

  // 降级回 v1
  await renameSymbol(view, newName, workspaceRoot, filePath);
  return true;
}

/** 提取指定偏移量处的单词 */
function extractWordAt(text: string, offset: number): string | null {
  const re = /[\w$]+/;
  let start = offset;
  let end = offset;
  while (start > 0 && re.test(text[start - 1])) start--;
  while (end < text.length && re.test(text[end])) end++;
  if (start === end) return null;
  return text.slice(start, end);
}

/** 应用 WorkspaceEdit changes */
async function applyWorkspaceEdit(
  changes: Record<string, Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }>>,
  workspaceRoot: string,
): Promise<void> {
  // 动态导入避免循环依赖
  const { writeTextFile, readTextFile } = await import("@/shared/fs");
  const { useEditorStore } = await import("@/stores/editor");
  const editorStore = useEditorStore();

  for (const [uri, edits] of Object.entries(changes)) {
    const path = uriToPath(uri);
    try {
      const content = await readTextFile(workspaceRoot, path);
      // 保留原换行风格（CRLF 文件不被改写成 LF）
      const newline = content.includes("\r\n") ? "\r\n" : "\n";
      const lines = content.split(/\r?\n/);

      // 按行倒序应用（避免偏移）
      const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        if (lineDiff !== 0) return lineDiff;
        return b.range.start.character - a.range.start.character;
      });

      for (const edit of sorted) {
        const { start, end } = edit.range;
        const lineObj = lines[start.line];
        if (lineObj === undefined) continue;
        const before = lineObj.slice(0, start.character);
        const after = (lines[end.line] ?? "").slice(end.character);
        if (start.line === end.line) {
          lines[start.line] = before + edit.newText + after;
        } else {
          lines.splice(
            start.line,
            end.line - start.line + 1,
            before + edit.newText + after,
          );
        }
      }

      const newContent = lines.join(newline);
      await writeTextFile(workspaceRoot, path, newContent);

      // 同步已打开标签的内存态：不更新的话，用户下次保存会把
      // rename 结果整体覆盖回旧内容（editor store 内存仍是旧文本）
      editorStore.syncFromDisk(path, newContent);
      // 补发 didChange，保持 LSP server 端文档与磁盘一致
      void lspManager.didChange(path, [], newContent);
    } catch (err) {
      console.error("[lsp] 应用 rename 编辑失败:", path, err);
    }
  }
}

// ==================== 统一扩展入口 ====================

/** 创建 LSP 扩展集合 */
export function createLspExtension(filePath: string): Extension[] {
  const extensions: Extension[] = [
    createHoverExtension(filePath),
    createSignatureHelpExtension(filePath),
  ];

  // 补全扩展：LSP 语义补全 + 本地兜底源（关键词/snippet/HTML/CSS/Tailwind/文档词）合并。
  // CM6 override 为多 source 并行合并：LSP 不可用（返回 null）时本地 source 自动生效，
  // 保证任意语言、无 server 环境下补全不为空（开箱即用）。
  extensions.push(
    autocompletion({
      override: [
        createLspCompletionSource(filePath),
        ...sourcesForPath(filePath),
      ],
      activateOnTyping: true,
    }),
  );

  return extensions;
}

/** 引用查找 keymap（Shift+F12） */
export function createLspReferencesKeymap(
  filePath: string,
  workspaceRoot: () => string | null,
): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: "Shift-F12",
        run: (view) => {
          const root = workspaceRoot();
          if (!root) return false;
          void lspFindReferences(view, filePath, root);
          return true;
        },
      },
    ]),
  );
}
