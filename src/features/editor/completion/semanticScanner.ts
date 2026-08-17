// ==================== JS/TS 轻量语义补全扫描器 ====================
// 零类型系统：基于正则的行级声明扫描（与 documentSymbols 同风格、可靠、可直测），
// 收集「光标之前已声明」的符号：import 绑定、顶层/局部 const/let/var/function/class/interface/type/enum。
// 另外提供 obj. 成员联想：对象字面量 key 与 class 成员提取。
// 纯函数、零 @/ 依赖，便于 node --experimental-strip-types 直测。
//
// 范围（v1 明确不做）：类型推断、作用域精确判定（函数外可见函数内变量）、
// 解构/重命名导入、块级作用域。

export interface LocalSymbol {
  name: string;
  kind: "variable" | "function" | "class" | "interface" | "type" | "enum";
  /** 声明上下文摘要（如 const / function / import） */
  detail: string;
  /** 声明行号（1-based） */
  line: number;
}

const WORD = "[A-Za-z_$][\\w$]*";

// ==================== 扫描结果记忆化 ====================
// 补全源在每次激活时同步调用这些扫描；光标前内容/全文未变（光标移动、
// 弹层重开、validFor 命中重过滤等）时按「djb2 + 长度」哈希复用上次结果，
// 避免对全文逐行跑正则。纯函数输入决定输出，哈希仅作去重键，碰撞概率可忽略。
let scanCache: { key: string; result: LocalSymbol[] } | null = null;
let objMemberCache: { key: string; result: string[] } | null = null;
let classMemberCache: { key: string; result: string[] } | null = null;

function djb2(text: string, end: number): number {
  let h = 5381;
  for (let i = 0; i < end; i += 1) {
    // Math.imul 保证真 int32 乘法：`h * 33` 溢出会逃逸为 double（每次堆分配），
    // 大文档 hash 从 ~1ms 降到 ~70µs（记忆化的命中成本主要就是 hash）
    h = Math.imul(h, 33) ^ text.charCodeAt(i);
  }
  return h >>> 0;
}

/** 行级声明模式（与 documentSymbols.DEF_PATTERNS 对齐，export 前缀全面覆盖） */
const DECL_PATTERNS: Array<{ re: RegExp; kind: LocalSymbol["kind"]; detail: string }> = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function", detail: "function" },
  { re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class", detail: "class" },
  { re: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/, kind: "interface", detail: "interface" },
  { re: /^\s*interface\s+([A-Za-z_$][\w$]*)/, kind: "interface", detail: "interface" },
  { re: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/, kind: "type", detail: "type" },
  { re: /^\s*type\s+([A-Za-z_$][\w$]*)/, kind: "type", detail: "type" },
  { re: /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/, kind: "enum", detail: "enum" },
  { re: /^\s*enum\s+([A-Za-z_$][\w$]*)/, kind: "enum", detail: "enum" },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: "variable", detail: "const" },
  { re: /^\s*(?:export\s+)?let\s+([A-Za-z_$][\w$]*)/, kind: "variable", detail: "let" },
  { re: /^\s*(?:export\s+)?var\s+([A-Za-z_$][\w$]*)/, kind: "variable", detail: "var" },
];

/** import 绑定提取（不依赖语法树，正则抓常见形态） */
const IMPORT_PATTERNS: Array<{ re: RegExp; detail: string }> = [
  { re: /import\s+type\s*\{([^}]*)\}\s+from/, detail: "import type" },
  { re: /import\s*\{([^}]*)\}\s+from/, detail: "import" },
  { re: /import\s+type\s+([A-Za-z_$][\w$]*)\s+from/, detail: "import type" },
  { re: /import\s+([A-Za-z_$][\w$]*)\s+from/, detail: "import" },
  { re: /import\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/, detail: "import = require" },
  { re: /const\s*\{([^}]*)\}\s*=\s*require\(/, detail: "destructure require" },
];

/** 从 import 绑定文本中提取单个标识符（去掉 as 别名、默认导出名） */
function extractBindingNames(bindText: string): string[] {
  const out: string[] = [];
  // 逗号分隔，每段取最后一个标识符（`a as b` 取 b；`a` 取 a）
  for (const raw of bindText.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(new RegExp(`(${WORD})(?:\\s+as\\s+(${WORD}))?$`));
    if (m) out.push(m[2] ?? m[1]);
  }
  return out;
}

/**
 * 扫描「光标之前」已声明的符号（模块级 + 局部声明统一收集）
 *
 * @param text 文档全文
 * @param cursorPos 光标 offset
 * @param extraImports 额外 import 绑定（跨文件符号补全时可传入，默认 []）
 */
export function scanLocalSymbols(
  text: string,
  cursorPos: number,
): LocalSymbol[] {
  // 结果只依赖光标前文本：内容未变（光标移动/弹层重开）时 O(1) 复用
  const key = `${cursorPos}:${djb2(text, cursorPos)}`;
  const cached = scanCache;
  if (cached && cached.key === key) return cached.result;

  const before = text.slice(0, cursorPos);
  const out: LocalSymbol[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: LocalSymbol["kind"], detail: string, line: number): void => {
    if (!name || seen.has(`${kind}:${name}`)) return;
    seen.add(`${kind}:${name}`);
    out.push({ name, kind, detail, line });
  };

  const lines = before.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { re, kind, detail } of DECL_PATTERNS) {
      const m = line.match(re);
      if (!m?.[1]) continue;
      push(m[1], kind, detail, i + 1);
    }
  }

  // import 绑定（跨多行 import 块的 v1 不做——只处理单行 import）
  for (const { re, detail } of IMPORT_PATTERNS) {
    const m = before.match(re);
    if (!m?.[1]) continue;
    const lineNo = before.slice(0, (m.index ?? 0)).split("\n").length;
    for (const name of extractBindingNames(m[1])) {
      push(name, "variable", detail, lineNo);
    }
  }

  scanCache = { key, result: out };
  return out;
}

/**
 * 提取对象字面量成员名：`const obj = { a, b: 1, "c": 2 }` → [a, b, c]
 * 取「光标之前最近」的同名声明（花括号配平，忽略嵌套 {} [] 与字符串）
 */
export function extractObjectMemberNames(text: string, objName: string): string[] {
  // 全文未变时复用（弹层重开/光标移动触发的重复激活）；未找到的空结果也缓存
  const key = `${objName}\u0000${text.length}:${djb2(text, text.length)}`;
  const cached = objMemberCache;
  if (cached && cached.key === key) return cached.result;

  const re = new RegExp(`(?:const|let|var)\\s+${objName}\\s*=\\s*\\{`, "g");
  const before = text;
  let match: RegExpExecArray | null;
  let lastBrace: number | null = null;
  while ((match = re.exec(before))) lastBrace = match.index + match[0].length - 1;

  const result =
    lastBrace === null ? [] : extractObjectBodyKeys(before, lastBrace);
  objMemberCache = { key, result };
  return result;
}

/** 从 `{` 起始位置提取对象体顶层 key（纯函数，供直测） */
export function extractObjectBodyKeys(text: string, braceIndex: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = braceIndex;
  const n = text.length;
  // 花括号配平，找对象结束
  for (; i < n; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i);
    }
  }
  if (i >= n) return [];

  // 对象体：braceIndex+1 .. i-1，按顶层逗号切段
  const body = text.slice(braceIndex + 1, i);
  const segments = splitTopLevel(body);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed || trimmed.startsWith("...") || trimmed.startsWith("[")) continue;
    // 段可能是 `key: value`、`key`（缩写）、`"key":`、`'key':`
    const m = trimmed.match(new RegExp(`^(?:"([^"]+)"|'([^']+)'|(${WORD}))\\s*:`));
    if (m) {
      out.push(m[1] ?? m[2] ?? m[3]);
    } else {
      const plain = trimmed.match(new RegExp(`^(${WORD})$`));
      if (plain) out.push(plain[1]);
    }
  }
  return out;
}

/** 按顶层逗号切分（忽略嵌套括号/字符串） */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    else if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i);
    } else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** 跳过字符串字面量（含转义），返回字符串结束位置 */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i;
    i += 1;
  }
  return i;
}

/**
 * 提取 class 成员名：`class Foo { bar() {} baz = 1; get qux() {} }` → [bar, baz, qux]
 * 找「光标之前最近」的同名 class 声明，花括号配平后提取顶层方法/属性。
 */
export function extractClassMemberNames(text: string, className: string): string[] {
  // 全文未变时复用（弹层重开/光标移动触发的重复激活）；未找到的空结果也缓存
  const key = `${className}\u0000${text.length}:${djb2(text, text.length)}`;
  const cached = classMemberCache;
  if (cached && cached.key === key) return cached.result;

  const re = new RegExp(`(?:class|interface)\\s+${className}\\b`, "g");
  let match: RegExpExecArray | null;
  let lastOpen: number | null = null;
  while ((match = re.exec(text))) {
    // 定位 class 体 `{`：从匹配尾向后找（跳过 extends/implements 子句）
    const from = match.index + match[0].length;
    const braceIdx = text.indexOf("{", from);
    if (braceIdx >= 0) lastOpen = braceIdx;
  }

  let out: string[];
  if (lastOpen === null) {
    out = [];
  } else {
    // 配平花括号，找 class 体结束
    let depth = 0;
    let i = lastOpen;
    const n = text.length;
    for (; i < n; i += 1) {
      const ch = text[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      if (ch === '"' || ch === "'" || ch === "`") i = skipString(text, i);
    }
    if (i >= n) {
      out = [];
    } else {
      const body = text.slice(lastOpen + 1, i);
      out = [];
      const seen = new Set<string>();
      const tryPush = (name: string | undefined): void => {
        if (name && !seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      };

      const lines = body.split("\n");
      const isSingleLine = lines.length <= 1;
      // 多行 class：按行提取（每行一个成员，方法/属性/构造器）
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(
          new RegExp(`^(?:public|private|protected|static|abstract|override|readonly|async|get|set\\s+)*(${WORD})\\s*(?:\\(|=|:|;|$)`),
        );
        if (m) tryPush(m[1]);
      }
      // 单行紧凑 class（`class A { b() {} c = 1 }`）：全局正则补抓方法/属性
      if (isSingleLine) {
        const re = new RegExp(`\\b(${WORD})\\s*(?:\\(|=|;)`, "g");
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(body))) tryPush(mm[1]);
      }
    }
  }
  classMemberCache = { key, result: out };
  return out;
}
