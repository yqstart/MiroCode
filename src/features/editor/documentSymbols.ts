import { basename } from "@/shared/fs";

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "interface"
  | "type"
  | "enum";

export interface DocumentSymbol {
  name: string;
  line: number;
  column: number;
  kind: SymbolKind;
}

const DEF_PATTERNS: { re: RegExp; kind: SymbolKind; nameGroup: number }[] = [
  {
    re: /^\s*export\s+default\s+async\s+function\s+([A-Za-z_$][\w$]*)/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^\s*export\s+async\s+function\s+([A-Za-z_$][\w$]*)/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^\s*export\s+function\s+([A-Za-z_$][\w$]*)/,
    kind: "function",
    nameGroup: 1,
  },
  { re: /^\s*async\s+function\s+([A-Za-z_$][\w$]*)/, kind: "function", nameGroup: 1 },
  { re: /^\s*function\s+([A-Za-z_$][\w$]*)/, kind: "function", nameGroup: 1 },
  {
    re: /^\s*export\s+default\s+class\s+([A-Za-z_$][\w$]*)/,
    kind: "class",
    nameGroup: 1,
  },
  {
    re: /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/,
    kind: "class",
    nameGroup: 1,
  },
  { re: /^\s*class\s+([A-Za-z_$][\w$]*)/, kind: "class", nameGroup: 1 },
  {
    re: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/,
    kind: "interface",
    nameGroup: 1,
  },
  { re: /^\s*interface\s+([A-Za-z_$][\w$]*)/, kind: "interface", nameGroup: 1 },
  { re: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/, kind: "type", nameGroup: 1 },
  { re: /^\s*type\s+([A-Za-z_$][\w$]*)/, kind: "type", nameGroup: 1 },
  { re: /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/, kind: "enum", nameGroup: 1 },
  { re: /^\s*enum\s+([A-Za-z_$][\w$]*)/, kind: "enum", nameGroup: 1 },
  {
    re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/,
    kind: "function",
    nameGroup: 1,
  },
  {
    re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/,
    kind: "variable",
    nameGroup: 1,
  },
  {
    re: /^\s*(?:export\s+)?let\s+([A-Za-z_$][\w$]*)\s*=/,
    kind: "variable",
    nameGroup: 1,
  },
  {
    re: /^\s*(?:export\s+)?var\s+([A-Za-z_$][\w$]*)\s*=/,
    kind: "variable",
    nameGroup: 1,
  },
  // class / object 方法：foo() { / async foo() { / foo(a: T): R {
  {
    re: /^\s*(?:public|private|protected|static|async|override|readonly|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
    kind: "method",
    nameGroup: 1,
  },
];

const METHOD_NAME_BLOCKLIST = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "with",
  "function",
  "class",
  "return",
  "typeof",
  "instanceof",
  "new",
  "await",
  "import",
  "export",
  "from",
]);

const WORD_RE = /[A-Za-z_$][\w$]*/;

/** Vue SFC：取光标所在区块的纯 JS/TS 文本与行号偏移 */
function scriptSliceForVue(
  doc: string,
  pos: number,
): { text: string; lineOffset: number } | null {
  const before = doc.slice(0, pos);
  const scriptOpen = before.lastIndexOf("<script");
  if (scriptOpen < 0) return null;
  const scriptCloseBefore = before.lastIndexOf("</script>");
  if (scriptCloseBefore > scriptOpen) return null;

  const after = doc.slice(pos);
  const scriptEndRel = after.indexOf("</script>");
  if (scriptEndRel < 0) return null;

  const contentStart = doc.indexOf(">", scriptOpen);
  if (contentStart < 0 || contentStart >= pos) return null;
  const scriptBody = doc.slice(contentStart + 1, pos + scriptEndRel);
  const lineOffset = doc.slice(0, contentStart + 1).split("\n").length - 1;
  return { text: scriptBody, lineOffset };
}

function indexLines(text: string, lineOffset = 0): Map<string, DocumentSymbol[]> {
  const map = new Map<string, DocumentSymbol[]>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { re, kind, nameGroup } of DEF_PATTERNS) {
      const m = line.match(re);
      if (!m?.[nameGroup]) continue;
      const name = m[nameGroup];
      if (kind === "method" && METHOD_NAME_BLOCKLIST.has(name)) continue;
      const column = (m.index ?? 0) + line.indexOf(name, m.index ?? 0) + 1;
      const sym: DocumentSymbol = {
        name,
        line: i + 1 + lineOffset,
        column: Math.max(1, column),
        kind,
      };
      const list = map.get(name) ?? [];
      list.push(sym);
      map.set(name, list);
    }
  }
  return map;
}

export function indexDocumentSymbols(
  doc: string,
  filePath: string,
): Map<string, DocumentSymbol[]> {
  const name = basename(filePath).toLowerCase();
  if (name.endsWith(".vue")) {
    const scriptOpen = doc.indexOf("<script");
    if (scriptOpen >= 0) {
      const contentStart = doc.indexOf(">", scriptOpen);
      const scriptClose = doc.indexOf("</script>", contentStart);
      if (contentStart >= 0 && scriptClose > contentStart) {
        const scriptBody = doc.slice(contentStart + 1, scriptClose);
        const lineOffset = doc.slice(0, contentStart + 1).split("\n").length - 1;
        return indexLines(scriptBody, lineOffset);
      }
    }
    return new Map();
  }
  return indexLines(doc);
}

export function wordAt(
  doc: string,
  pos: number,
): { word: string; from: number; to: number } | null {
  if (pos < 0 || pos > doc.length) return null;
  let from = pos;
  let to = pos;
  while (from > 0 && WORD_RE.test(doc[from - 1])) from -= 1;
  while (to < doc.length && WORD_RE.test(doc[to])) to += 1;
  if (from === to) {
    if (pos < doc.length && WORD_RE.test(doc[pos])) {
      from = pos;
      to = pos + 1;
      while (to < doc.length && WORD_RE.test(doc[to])) to += 1;
    } else {
      return null;
    }
  }
  const word = doc.slice(from, to);
  if (!WORD_RE.test(word)) return null;
  return { word, from, to };
}

function lineColumnAt(doc: string, pos: number): { line: number; column: number } {
  const before = doc.slice(0, pos);
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** 在当前文件内查找符号定义（优先取光标前的最近声明） */
export function findSymbolDefinition(
  doc: string,
  pos: number,
  filePath: string,
): { line: number; column: number } | null {
  const hit = wordAt(doc, pos);
  if (!hit || pos < hit.from || pos > hit.to) return null;

  const name = basename(filePath).toLowerCase();
  let index: Map<string, DocumentSymbol[]>;

  if (name.endsWith(".vue")) {
    const slice = scriptSliceForVue(doc, pos);
    if (!slice) return null;
    index = indexLines(slice.text, slice.lineOffset);
  } else {
    index = indexLines(doc);
  }

  const defs = index.get(hit.word);
  if (!defs?.length) return null;

  const cursor = lineColumnAt(doc, pos);
  let best: DocumentSymbol | null = null;
  for (const def of defs) {
    if (def.line < cursor.line || (def.line === cursor.line && def.column < cursor.column)) {
      if (!best || def.line > best.line || (def.line === best.line && def.column > best.column)) {
        best = def;
      }
    }
  }
  const chosen = best ?? defs[0];
  return { line: chosen.line, column: chosen.column };
}
