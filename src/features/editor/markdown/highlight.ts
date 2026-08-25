// ==================== MD 预览 · 轻量代码高亮 ====================
// 自研：5 类 token（keyword / string / comment / number / type），
// 仅做 HTML 转义 + 正则着色，覆盖常见语言；不支持的语言原样返回。
// 体积 ~100 行，不引 highlight.js / shiki。
// 主题色全部走 CSS 变量，输出 <span class="tk-*"> 由 .md-preview 样式着色。

export type SupportedLang =
  | "js"
  | "ts"
  | "jsx"
  | "tsx"
  | "json"
  | "bash"
  | "sh"
  | "shell"
  | "py"
  | "python"
  | "yaml"
  | "yml"
  | "md"
  | "markdown";

/** marked 给的 lang 可能是 "javascript" / "typescript" / "sh" / "text" 等，归一化 */
export function normalizeLang(raw: string | undefined): SupportedLang | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s === "js" || s === "javascript") return "js";
  if (s === "ts" || s === "typescript") return "ts";
  if (s === "jsx") return "jsx";
  if (s === "tsx") return "tsx";
  if (s === "json" || s === "jsonc") return "json";
  if (s === "bash" || s === "sh" || s === "shell" || s === "zsh") return "bash";
  if (s === "py" || s === "python") return "py";
  if (s === "yaml" || s === "yml") return "yaml";
  if (s === "md" || s === "markdown") return "md";
  return null;
}

/** HTML 转义（先于任何 token 着色，避免内容里 < > & 被误判） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 单行注释起始 token；用于先剥离注释，避免内部字符被规则误命中；
 *  null 表示该语言无单行注释。 */
const COMMENT_LINE: Record<string, RegExp | null> = {
  js: /\/\/.*$/gm,
  ts: /\/\/.*$/gm,
  jsx: /\/\/.*$/gm,
  tsx: /\/\/.*$/gm,
  json: null,
  bash: /#.*$/gm,
  py: /#.*$/gm,
  yaml: /#.*$/gm,
  md: null,
};

const KEYWORDS: Record<string, string[]> = {
  js: [
    "var", "let", "const", "function", "return", "if", "else", "for",
    "while", "do", "switch", "case", "break", "continue", "new", "delete",
    "typeof", "instanceof", "in", "of", "this", "class", "extends",
    "super", "import", "export", "from", "as", "default", "async", "await",
    "try", "catch", "finally", "throw", "yield", "void", "null", "true",
    "false", "undefined",
  ],
  ts: [
    "var", "let", "const", "function", "return", "if", "else", "for",
    "while", "do", "switch", "case", "break", "continue", "new", "delete",
    "typeof", "instanceof", "in", "of", "this", "class", "extends",
    "super", "import", "export", "from", "as", "default", "async", "await",
    "try", "catch", "finally", "throw", "yield", "void", "null", "true",
    "false", "undefined", "interface", "type", "enum", "namespace",
    "declare", "public", "private", "protected", "readonly", "static",
    "abstract", "implements", "keyof", "infer", "never", "any", "unknown",
    "is", "satisfies",
  ],
  jsx: [
    "var", "let", "const", "function", "return", "if", "else", "for",
    "while", "switch", "case", "break", "continue", "new", "this",
    "class", "extends", "import", "export", "from", "as", "default",
    "async", "await", "try", "catch", "finally", "throw", "null",
    "true", "false", "undefined",
  ],
  tsx: [
    "var", "let", "const", "function", "return", "if", "else", "for",
    "while", "switch", "case", "break", "continue", "new", "this",
    "class", "extends", "import", "export", "from", "as", "default",
    "async", "await", "try", "catch", "finally", "throw", "null",
    "true", "false", "undefined", "interface", "type", "enum", "declare",
    "public", "private", "protected", "readonly", "static", "abstract",
    "implements", "keyof", "infer", "never", "any", "unknown", "is",
    "satisfies",
  ],
  json: ["true", "false", "null"],
  bash: [
    "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
    "case", "esac", "in", "function", "return", "export", "local",
    "echo", "cd", "pwd", "set", "unset",
  ],
  py: [
    "def", "class", "return", "if", "elif", "else", "for", "while",
    "break", "continue", "import", "from", "as", "try", "except",
    "finally", "raise", "with", "yield", "lambda", "pass", "global",
    "nonlocal", "True", "False", "None", "and", "or", "not", "is", "in",
    "async", "await",
  ],
  yaml: ["true", "false", "null", "yes", "no", "on", "off", "~"],
  md: [],
};

const TYPES: Record<string, string[]> = {
  js: [
    "Object", "Array", "Map", "Set", "WeakMap", "WeakSet", "Promise",
    "Date", "RegExp", "Error", "TypeError", "RangeError", "JSON",
    "Math", "Number", "String", "Boolean", "Symbol", "Function",
  ],
  ts: [
    "Object", "Array", "Map", "Set", "WeakMap", "WeakSet", "Promise",
    "Date", "RegExp", "Error", "TypeError", "RangeError", "JSON",
    "Math", "Number", "String", "Boolean", "Symbol", "Function",
    "Partial", "Required", "Readonly", "Record", "Pick", "Omit",
    "Exclude", "Extract", "NonNullable", "ReturnType", "Parameters",
    "InstanceType", "ThisType", "Awaited",
  ],
  jsx: ["Object", "Array", "Promise", "React"],
  tsx: ["Object", "Array", "Promise", "React", "Partial", "Required", "Readonly", "Record", "Pick", "Omit"],
  json: [],
  bash: [],
  py: [
    "int", "float", "str", "bool", "list", "dict", "set", "tuple",
    "object", "type", "Exception", "ValueError", "TypeError", "KeyError",
  ],
  yaml: [],
  md: [],
};

/** 字符串/模板字符串 pattern（避免与注释规则冲突，先识别字符串） */
const STRING_PATTERNS: Record<string, RegExp[]> = {
  js: [
    /`(?:\\.|[^`\\])*`/g,        // template
    /'(?:\\.|[^'\\])*'/g,        // single
    /"(?:\\.|[^"\\])*"/g,        // double
  ],
  ts: [
    /`(?:\\.|[^`\\])*`/g,
    /'(?:\\.|[^'\\])*'/g,
    /"(?:\\.|[^"\\])*"/g,
  ],
  jsx: [
    /'(?:\\.|[^'\\])*'/g,
    /"(?:\\.|[^"\\])*"/g,
  ],
  tsx: [
    /'(?:\\.|[^'\\])*'/g,
    /"(?:\\.|[^"\\])*"/g,
  ],
  json: [/"(?:\\.|[^"\\])*"/g],
  bash: [
    /'(?:\\.|[^'\\])*'/g,
    /"(?:\\.|[^"\\])*"/g,
    /`(?:\\.|[^`\\])*`/g,
  ],
  py: [
    /"""[\s\S]*?"""/g,           // triple double
    /'''[\s\S]*?'''/g,           // triple single
    /"(?:\\.|[^"\\])*"/g,
    /'(?:\\.|[^'\\])*'/g,
  ],
  yaml: [/"(?:\\.|[^"\\])*"/g, /'(?:\\.|[^'\\])*'/g],
  md: [],
};

/** 数字 pattern */
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

/** 给一类 token 着色；safe=false 表示内容已含 HTML（被 escape 之前的），需先 escape */
function wrap(className: string, body: string): string {
  return `<span class="tk-${className}">${body}</span>`;
}

/**
 * 主入口：对一段源码做高亮，返回 HTML 字符串（已被 escape + 着色）。
 * lang 不支持时直接返回 escape 后的文本（不再嵌套 span）。
 */
export function highlight(code: string, lang: string | undefined): string {
  const norm = normalizeLang(lang);
  if (!norm) return escapeHtml(code);

  // 先在原始源码上把字符串/注释占位，所有后续正则只处理源码文本，
  // 不会把已经生成的 <span class="tk-*"> 标签再次当成源码匹配，
  // 也不会因 escapeHtml 把引号变成 &quot;/&#39; 而错过字符串。
  const placeholders: string[] = [];
  let placeholderIndex = 0;
  let stage1 = code;
  const placeholder = (className: "string" | "comment" | "number" | "type" | "keyword", body: string): string => {
    // 私用区字符不属于数字/单词，后续 token 正则不会命中；
    // 索引通过字符码点保存，最后再还原对应的安全 HTML。
    const index = placeholderIndex++;
    const token = `\u0000${String.fromCharCode(0xe000 + index)}\u0000`;
    placeholders.push(wrap(className, body));
    return token;
  };

  // 1) 标记字符串位置（用占位符避免后续规则破坏字符串内容）
  const strings = STRING_PATTERNS[norm] ?? [];
  for (const pat of strings) {
    stage1 = stage1.replace(pat, (m) => placeholder("string", escapeHtml(m)));
  }

  // 2) 标记单行注释（字符串已占位，所以注释标记不会误命中字符串内容）
  const commentRe = COMMENT_LINE[norm];
  if (commentRe) {
    stage1 = stage1.replace(commentRe, (m) => placeholder("comment", escapeHtml(m)));
  }
  // 多行注释：js/ts/jsx/tsx 的 /* ... */
  if (norm === "js" || norm === "ts" || norm === "jsx" || norm === "tsx") {
    stage1 = stage1.replace(/\/\*[\s\S]*?\*\//g, (m) => placeholder("comment", escapeHtml(m)));
  }

  // 3) 统一转义剩余源码；占位符不含 HTML 特殊字符。
  stage1 = escapeHtml(stage1);

  // 4) 数字、类型、关键字只在尚未插入 HTML 标签的源码上着色。
  stage1 = stage1.replace(NUMBER_RE, (m) => placeholder("number", m));

  // 4) 类型（首字母大写标识符）
  const types = TYPES[norm] ?? [];
  if (types.length) {
    const typeRe = new RegExp(
      `\\b(${types.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
      "g",
    );
    stage1 = stage1.replace(typeRe, (m) => placeholder("type", m));
  }

  // 5) 关键字
  const kws = KEYWORDS[norm] ?? [];
  if (kws.length) {
    const kwRe = new RegExp(
      `\\b(${kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
      "g",
    );
    stage1 = stage1.replace(kwRe, (m) => placeholder("keyword", m));
  }

  // 6) 最后还原所有 token HTML，避免任何后续规则破坏标签。
  return stage1.replace(/\u0000([\ue000-\uf8ff])\u0000/g, (_, marker) => {
    const index = marker.charCodeAt(0) - 0xe000;
    return placeholders[index] ?? "";
  });
}
