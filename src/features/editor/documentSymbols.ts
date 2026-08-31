// 本地 basename（node 直测环境无 @/ 别名，与 semanticScanner 保持零依赖风格）
function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

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

/**
 * CSS class 选择器：匹配 `.foo {` / `.foo,` / `.foo.bar {` / `&.foo {` / `.foo .bar {`
 * 只取行内**第一个** class 名（`.foo.bar` 取 `foo`），避免长链歧义。
 * 不匹配 `#id`、属性选择器、伪类。
 */
const CSS_CLASS_RE = /\.([A-Za-z_][\w-]*)/;

function indexLines(
  text: string,
  lineOffset = 0,
  includeCssClasses = false,
): Map<string, DocumentSymbol[]> {
  const map = new Map<string, DocumentSymbol[]>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let matchedJs = false;
    for (const { re, kind, nameGroup } of DEF_PATTERNS) {
      const m = line.match(re);
      if (!m?.[nameGroup]) continue;
      const name = m[nameGroup];
      if (kind === "method" && METHOD_NAME_BLOCKLIST.has(name)) continue;
      matchedJs = true;
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
    // JS 模式未命中时，尝试 CSS class 选择器识别（.foo { / .foo, / &.foo 等）
    if (!matchedJs && includeCssClasses) {
      const cm = line.match(CSS_CLASS_RE);
      if (cm?.[1]) {
        const className = cm[1];
        const classIdx = line.indexOf(`.${className}`);
        const column = classIdx + 2; // 跳过 `.`，1-based
        const sym: DocumentSymbol = {
          name: className,
          line: i + 1 + lineOffset,
          column: Math.max(1, column),
          kind: "class",
        };
        const list = map.get(className) ?? [];
        list.push(sym);
        map.set(className, list);
      }
    }
  }
  return map;
}

// ==================== 符号索引缓存 ====================
// 导航下划线装饰在每次光标移动/按键都会查符号索引；大文件全量逐行正则
// 重建是输入卡顿的根源之一。这里按「内容 hash + 字符串引用」记忆化：
// 纯光标移动（doc 字符串引用不变）O(1) 命中；内容变化才重新索引。
// hash 仅作去重键，避免每次比较整串；djb2 + 长度碰撞概率可忽略。
let symbolIndexCache: {
  fileKey: string;
  hash: string;
  doc: string;
  result: Map<string, DocumentSymbol[]>;
} | null = null;

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    // Math.imul：真 int32 乘法，避免 h*33 溢出逃逸为 double（每次堆分配）
    h = Math.imul(h, 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36) + ":" + s.length;
}

function computeDocumentIndex(
  doc: string,
  filePath: string,
): Map<string, DocumentSymbol[]> {
  const name = basename(filePath).toLowerCase();
  if (name.endsWith(".vue") || name.endsWith(".html") || name.endsWith(".htm")) {
    const map = new Map<string, DocumentSymbol[]>();
    // 扫描所有 <script ...>...</script> 段（可能多个）
    appendVueBlockSymbols(doc, "script", map);
    // 扫描所有 <style ...>...</style> 段（CSS class 选择器）
    appendVueBlockSymbols(doc, "style", map);
    return map;
  }
  // 只有样式文件启用 CSS class 识别；脚本里的 `.method` / `...spread`
  // 不能被误当作 `.class` 选择器定义。
  const includeCssClasses = /\.(?:css|scss|sass|less)$/i.test(name);
  return indexLines(doc, 0, includeCssClasses);
}

export function indexDocumentSymbols(
  doc: string,
  filePath: string,
): Map<string, DocumentSymbol[]> {
  const fileKey = basename(filePath).toLowerCase();
  const hit = symbolIndexCache;
  // ① 同一字符串实例（纯光标移动）：O(1) 直接复用，不 hash
  if (hit && hit.fileKey === fileKey && hit.doc === doc) return hit.result;
  // ② 内容 hash 一致（新字符串但内容相同）：去重后复用，跳过全量重建
  const hash = djb2(doc);
  if (hit && hit.fileKey === fileKey && hit.hash === hash) return hit.result;
  const result = computeDocumentIndex(doc, filePath);
  symbolIndexCache = { fileKey, hash, doc, result };
  return result;
}

/** 扫描 Vue SFC 中所有指定标签段（script/style），把符号追加到 map */
function appendVueBlockSymbols(
  doc: string,
  tag: "script" | "style",
  map: Map<string, DocumentSymbol[]>,
): void {
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let searchFrom = 0;
  for (;;) {
    const openIdx = doc.indexOf(openTag, searchFrom);
    if (openIdx < 0) break;
    const contentStart = doc.indexOf(">", openIdx);
    if (contentStart < 0) break;
    const closeIdx = doc.indexOf(closeTag, contentStart + 1);
    if (closeIdx < 0) break;
    const body = doc.slice(contentStart + 1, closeIdx);
    const lineOffset = doc.slice(0, contentStart + 1).split("\n").length - 1;
    const blockMap = indexLines(body, lineOffset, tag === "style");
    for (const [symName, list] of blockMap.entries()) {
      const existing = map.get(symName) ?? [];
      existing.push(...list);
      map.set(symName, existing);
    }
    searchFrom = closeIdx + closeTag.length;
  }
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
  // 走记忆化的全文档索引（host/template 内也能命中 script/style 段定义），
  // 避免每次光标移动/按键对全文档逐行重建索引
  const index = indexDocumentSymbols(doc, filePath);
  return pickClosest(index.get(hit.word), doc, pos);
}

/** 在 defs 中挑「光标之前最近的声明」；空数组返回 null */
function pickClosest(
  defs: DocumentSymbol[] | undefined,
  doc: string,
  pos: number,
): { line: number; column: number } | null {
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
