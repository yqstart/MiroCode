import {
  autocompletion,
  completeAnyWord,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { basename } from "@/shared/fs";

const JS_KEYWORDS = [
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "import",
  "export",
  "from",
  "default",
  "async",
  "await",
  "class",
  "extends",
  "implements",
  "new",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "instanceof",
  "interface",
  "type",
  "enum",
  "namespace",
  "public",
  "private",
  "protected",
  "readonly",
  "static",
  "abstract",
  "as",
  "satisfies",
  "undefined",
  "null",
  "true",
  "false",
  "this",
  "super",
  "yield",
  "of",
  "in",
  "void",
  "never",
  "unknown",
  "any",
  "string",
  "number",
  "boolean",
  "object",
];

const JS_SNIPPETS: Completion[] = [
  snippetCompletion("console.log(${})", {
    label: "log",
    type: "function",
    detail: "console.log",
    boost: 2,
  }),
  snippetCompletion("console.error(${})", {
    label: "error",
    type: "function",
    detail: "console.error",
    boost: 2,
  }),
  snippetCompletion("function ${name}(${args}) {\n  ${}\n}", {
    label: "fn",
    type: "keyword",
    detail: "function",
    boost: 2,
  }),
  snippetCompletion("async function ${name}(${args}) {\n  ${}\n}", {
    label: "afn",
    type: "keyword",
    detail: "async function",
    boost: 2,
  }),
  snippetCompletion("(${args}) => {\n  ${}\n}", {
    label: "af",
    type: "keyword",
    detail: "arrow function",
    boost: 2,
  }),
  snippetCompletion("import { ${names} } from '${module}';", {
    label: "imp",
    type: "keyword",
    detail: "import named",
    boost: 2,
  }),
  snippetCompletion("import ${name} from '${module}';", {
    label: "imd",
    type: "keyword",
    detail: "import default",
    boost: 2,
  }),
  snippetCompletion("export default ${}", {
    label: "ed",
    type: "keyword",
    detail: "export default",
    boost: 2,
  }),
  snippetCompletion("if (${condition}) {\n  ${}\n}", {
    label: "if",
    type: "keyword",
    detail: "if block",
    boost: 2,
  }),
  snippetCompletion("try {\n  ${}\n} catch (${err}) {\n  \n}", {
    label: "try",
    type: "keyword",
    detail: "try/catch",
    boost: 2,
  }),
];

const HTML_TAGS = [
  "div",
  "span",
  "p",
  "a",
  "ul",
  "ol",
  "li",
  "button",
  "form",
  "label",
  "select",
  "option",
  "textarea",
  "section",
  "header",
  "footer",
  "nav",
  "main",
  "article",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "template",
  "slot",
  "component",
  "router-link",
  "router-view",
];

const VOID_HTML_TAGS = ["img", "br", "hr", "meta", "link", "input"];

const HTML_TAG_SNIPPETS: Completion[] = [
  ...HTML_TAGS.map((tag) =>
    snippetCompletion(`<${tag}>\${}</${tag}>`, {
      label: tag,
      type: "type",
      detail: "HTML",
      boost: 3,
    }),
  ),
  ...VOID_HTML_TAGS.map((tag) =>
    snippetCompletion(`<${tag} />`, {
      label: tag,
      type: "type",
      detail: "HTML",
      boost: 3,
    }),
  ),
];

const CSS_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "border",
  "border-radius",
  "background",
  "background-color",
  "color",
  "font-size",
  "font-weight",
  "line-height",
  "flex",
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "overflow",
  "opacity",
  "z-index",
  "box-shadow",
  "transform",
  "transition",
  "cursor",
  "text-align",
];

const TAILWIND_CLASSES = [
  "flex",
  "grid",
  "block",
  "inline-flex",
  "hidden",
  "relative",
  "absolute",
  "fixed",
  "items-center",
  "justify-center",
  "justify-between",
  "gap-2",
  "gap-4",
  "p-2",
  "p-4",
  "px-4",
  "py-2",
  "m-0",
  "w-full",
  "h-full",
  "min-h-0",
  "text-sm",
  "text-base",
  "font-medium",
  "font-semibold",
  "rounded",
  "rounded-md",
  "rounded-lg",
  "border",
  "truncate",
  "overflow-hidden",
  "overflow-auto",
  "cursor-pointer",
];

function isInCommentOrString(context: CompletionContext): boolean {
  const tree = syntaxTree(context.state);
  let node = tree.resolveInner(context.pos, -1);
  for (let i = 0; i < 4 && node; i += 1) {
    const name = node.name;
    if (
      name.includes("Comment") ||
      name.includes("comment") ||
      name === "String" ||
      name === "String2" ||
      name === "TemplateString"
    ) {
      return true;
    }
    const parent = node.parent;
    if (!parent) break;
    node = parent;
  }
  return false;
}

function isVueTemplateContext(doc: string, pos: number): boolean {
  const before = doc.slice(0, pos);
  const openTemplate = before.lastIndexOf("<template");
  const closeTemplate = before.lastIndexOf("</template>");
  if (openTemplate >= 0 && openTemplate > closeTemplate) return true;
  const openScript = before.lastIndexOf("<script");
  const closeScript = before.lastIndexOf("</script>");
  if (openScript >= 0 && openScript > closeScript) return false;
  const openStyle = before.lastIndexOf("<style");
  const closeStyle = before.lastIndexOf("</style>");
  if (openStyle >= 0 && openStyle > closeStyle) return false;
  return openTemplate >= 0;
}

function isMarkupContext(context: CompletionContext, filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  if (name.endsWith(".html") || name.endsWith(".htm")) return true;
  if (name.endsWith(".vue")) {
    return isVueTemplateContext(context.state.doc.toString(), context.pos);
  }
  return false;
}

function isScriptContext(context: CompletionContext, filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  if (
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".mjs") ||
    name.endsWith(".cjs")
  ) {
    return true;
  }
  if (name.endsWith(".vue")) {
    const before = context.state.doc.sliceString(0, context.pos);
    const openScript = before.lastIndexOf("<script");
    const closeScript = before.lastIndexOf("</script>");
    return openScript >= 0 && openScript > closeScript;
  }
  return false;
}

function isCssContext(context: CompletionContext, filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  if (
    name.endsWith(".css") ||
    name.endsWith(".scss") ||
    name.endsWith(".sass") ||
    name.endsWith(".less")
  ) {
    return true;
  }
  if (name.endsWith(".vue")) {
    const before = context.state.doc.sliceString(0, context.pos);
    const openStyle = before.lastIndexOf("<style");
    const closeStyle = before.lastIndexOf("</style>");
    return openStyle >= 0 && openStyle > closeStyle;
  }
  return false;
}

function keywordSource(context: CompletionContext): ReturnType<CompletionSource> {
  if (isInCommentOrString(context)) return null;
  const word = context.matchBefore(/\w*/);
  if (!word || word.text.length < 1) return null;
  if (word.from === word.to && !context.explicit) return null;

  const typed = word.text.toLowerCase();
  const keywords = JS_KEYWORDS.filter((k) => k.startsWith(typed)).map((label) => ({
    label,
    type: "keyword" as const,
    boost: 1,
  }));
  const snippets = JS_SNIPPETS.filter((s) =>
    s.label.toLowerCase().startsWith(typed),
  );

  const options = [...snippets, ...keywords].slice(0, 24);
  if (!options.length) return null;

  return {
    from: word.from,
    options,
    validFor: /^\w*$/,
  };
}

function htmlTagSource(context: CompletionContext): ReturnType<CompletionSource> {
  const word = context.matchBefore(/[\w-]*/);
  if (!word || word.text.length < 1) return null;
  if (word.from === word.to && !context.explicit) return null;

  const typed = word.text.toLowerCase();
  const options = HTML_TAG_SNIPPETS.filter((s) =>
    s.label.toLowerCase().startsWith(typed),
  ).slice(0, 20);
  if (!options.length) return null;

  return {
    from: word.from,
    options,
    validFor: /^[\w-]*$/,
  };
}

function cssSource(context: CompletionContext): ReturnType<CompletionSource> {
  if (isInCommentOrString(context)) return null;
  const word = context.matchBefore(/[\w-]*/);
  if (!word || word.text.length < 2) return null;
  if (word.from === word.to && !context.explicit) return null;

  const typed = word.text.toLowerCase();
  const options = CSS_PROPERTIES.filter((p) => p.startsWith(typed))
    .slice(0, 16)
    .map((label) => ({
      label,
      type: "property" as const,
      detail: "CSS",
    }));
  if (!options.length) return null;

  return {
    from: word.from,
    options,
    validFor: /^[\w-]*$/,
  };
}

function tailwindSource(
  context: CompletionContext,
  filePath: string,
): ReturnType<CompletionSource> {
  const word = context.matchBefore(/[\w:-]*/);
  if (!word || word.text.length < 2) return null;
  if (word.from === word.to && !context.explicit) return null;

  const before = context.state.doc.sliceString(Math.max(0, word.from - 80), word.from);
  // 兼容 HTML class= / Vue :class= / React className= / Svelte class:list=
  const inClassAttr = /(?:class|className|:class|class:list)\s*=\s*["'{][^"'{}]*$/.test(before);
  if (!inClassAttr && !isCssContext(context, filePath)) {
    return null;
  }

  const typed = word.text.toLowerCase();
  const options = TAILWIND_CLASSES.filter((c) => c.startsWith(typed))
    .slice(0, 16)
    .map((label) => ({
      label,
      type: "constant" as const,
      detail: "Tailwind",
    }));
  if (!options.length) return null;

  return {
    from: word.from,
    options,
    validFor: /^[\w:-]*$/,
  };
}

/** 仅 Ctrl+Space 时补全文档词，避免噪声 */
function documentWordSource(context: CompletionContext): ReturnType<CompletionSource> {
  if (!context.explicit) return null;
  return completeAnyWord(context);
}

function sourcesForPath(filePath: string): CompletionSource[] {
  const sources: CompletionSource[] = [];

  sources.push((context) => {
    if (isScriptContext(context, filePath)) {
      return keywordSource(context);
    }
    return null;
  });

  sources.push((context) => {
    if (isMarkupContext(context, filePath)) {
      return htmlTagSource(context);
    }
    return null;
  });

  sources.push((context) => {
    if (isCssContext(context, filePath)) {
      return cssSource(context);
    }
    return null;
  });

  sources.push((context) => {
    if (isMarkupContext(context, filePath) || isCssContext(context, filePath)) {
      return tailwindSource(context, filePath);
    }
    return null;
  });

  sources.push(documentWordSource);
  return sources;
}

/** 本地语法 / 片段补全（无 AI、无网络） */
export function createCompletionExtension(filePath: string): Extension {
  const sources = sourcesForPath(filePath);
  return [
    autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 18,
      icons: true,
      closeOnBlur: true,
      defaultKeymap: true,
    }),
    EditorState.languageData.of(() =>
      sources.map((autocomplete) => ({ autocomplete })),
    ),
  ];
}
