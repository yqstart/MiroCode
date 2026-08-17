// ==================== Emmet 缩写展开（VS Code 同款） ====================
// Tab 键展开：光标前匹配 Emmet 缩写 → emmet 库展开 → 按当前行缩进对齐插入。
// emmet 纯 JS 库动态 import（拆独立 chunk），仅 html/vue 上下文启用。
//
// 触发链路（CodeMirrorEditor keymap）：ghost 接受（Prec.highest）→ completionKeymap
// （popup 打开时选中项）→ 本扩展 → indentWithTab。无缩写时返回 false 让位缩进。

import type { EditorView } from "@codemirror/view";

/** 取文件名（POSIX 语义，零依赖保持可直测） */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** Emmet 缩写匹配：光标前允许的标记缩写字符集 */
const ABBR_RE = /([a-zA-Z][\w+>#.\[\]()$*^!-]*)$/;

/** 缩写长度上限（防误匹配长文本） */
const ABBR_MAX_LEN = 80;

/**
 * 匹配光标前的 Emmet 缩写（纯函数，可直测）
 *
 * 规则：缩写必须以字母开头，且前一个字符不能是词符（避免把普通标识符当缩写）。
 */
export function matchEmmetAbbreviation(beforeCursor: string): string | null {
  const m = beforeCursor.match(ABBR_RE);
  if (!m) return null;
  const abbr = m[1];
  if (abbr.length > ABBR_MAX_LEN) return null;
  const prev = beforeCursor[(m.index ?? 0) - 1] ?? "";
  if (/[\w]/.test(prev)) return null;
  return abbr;
}

/**
 * 按当前行缩进对齐展开结果：
 * - 首行保持原样（插入点前已有行缩进）
 * - 后续行 = 行缩进 + 每层 tab（→ 缩进单位）换算
 * emmet 输出层级用 \t，缩进单位取当前行缩进（多数项目行缩进即一级），无缩进时 2 空格。
 */
export function indentExpanded(expanded: string, baseIndent: string): string {
  const lines = expanded.split("\n");
  if (lines.length <= 1) return expanded;
  const indentUnit = baseIndent || "  ";
  return lines
    .map((ln, i) => (i === 0 ? ln : baseIndent + ln.replace(/\t/g, indentUnit)))
    .join("\n");
}

/** 按文件与光标上下文选 emmet 语法 */
export function emmetSyntax(filePath: string, beforeCursor: string): "html" | "css" {
  const name = basename(filePath).toLowerCase();
  if (/\.(css|scss|less|sass)$/.test(name)) return "css";
  if (name.endsWith(".vue")) {
    // style 段 → css（粗糙判断：光标前最近 `<style` 未闭合）
    const styleOpen = beforeCursor.lastIndexOf("<style");
    const styleClose = beforeCursor.lastIndexOf("</style>");
    if (styleOpen > styleClose) return "css";
  }
  return "html";
}

let emmetPromise: Promise<{ default: (abbr: string, config: object) => string }> | null = null;

/**
 * Tab 展开：光标前是 Emmet 缩写则展开并插入。
 * 异步（emmet 库懒加载）；成功消费 Tab 返回 true，无缩写/展开失败返回 false。
 */
export async function expandEmmetAt(view: EditorView, filePath: string): Promise<boolean> {
  const { state } = view;
  const head = state.selection.main.head;
  const before = state.doc.sliceString(0, head);
  const abbr = matchEmmetAbbreviation(before);
  if (!abbr) return false;

  let expand: (abbr: string, config: object) => string;
  try {
    emmetPromise ??= import("emmet");
    const mod = await emmetPromise;
    expand = mod.default;
  } catch {
    return false;
  }

  let out: string;
  try {
    out = expand(abbr, { syntax: emmetSyntax(filePath, before) });
  } catch {
    return false;
  }
  if (!out || out === abbr) return false;

  const from = head - abbr.length;
  const line = state.doc.lineAt(head);
  const baseIndent = line.text.match(/^\s*/)?.[0] ?? "";
  const insert = indentExpanded(out, baseIndent);

  view.dispatch({
    changes: { from, to: head, insert },
    selection: { anchor: from + insert.length },
    userEvent: "emmet.expand",
  });
  return true;
}
