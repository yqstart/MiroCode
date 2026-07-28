import {
  autocompletion,
  completeAnyWord,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
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
  }),
  snippetCompletion("console.error(${})", {
    label: "error",
    type: "function",
    detail: "console.error",
  }),
  snippetCompletion("function ${name}(${args}) {\n  ${}\n}", {
    label: "fn",
    type: "keyword",
    detail: "function",
  }),
  snippetCompletion("async function ${name}(${args}) {\n  ${}\n}", {
    label: "afn",
    type: "keyword",
    detail: "async function",
  }),
  snippetCompletion("(${args}) => {\n  ${}\n}", {
    label: "af",
    type: "keyword",
    detail: "arrow function",
  }),
  snippetCompletion("import { ${names} } from '${module}';", {
    label: "imp",
    type: "keyword",
    detail: "import named",
  }),
  snippetCompletion("import ${name} from '${module}';", {
    label: "imd",
    type: "keyword",
    detail: "import default",
  }),
  snippetCompletion("export default ${}", {
    label: "ed",
    type: "keyword",
    detail: "export default",
  }),
  snippetCompletion("if (${condition}) {\n  ${}\n}", {
    label: "if",
    type: "keyword",
    detail: "if block",
  }),
  snippetCompletion("try {\n  ${}\n} catch (${err}) {\n  \n}", {
    label: "try",
    type: "keyword",
    detail: "try/catch",
  }),
];

const CSS_PROPERTIES = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
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
  "grid-template-columns",
  "overflow",
  "opacity",
  "z-index",
  "box-shadow",
  "transform",
  "transition",
  "cursor",
  "object-fit",
  "text-align",
  "white-space",
];

const TAILWIND_CLASSES = [
  "flex",
  "grid",
  "block",
  "inline",
  "inline-flex",
  "hidden",
  "relative",
  "absolute",
  "fixed",
  "sticky",
  "items-center",
  "items-start",
  "items-end",
  "justify-center",
  "justify-between",
  "justify-start",
  "justify-end",
  "gap-1",
  "gap-2",
  "gap-3",
  "gap-4",
  "p-2",
  "p-3",
  "p-4",
  "px-3",
  "px-4",
  "py-1",
  "py-2",
  "m-0",
  "m-2",
  "mt-2",
  "mt-4",
  "mb-2",
  "mb-4",
  "ml-auto",
  "mr-auto",
  "w-full",
  "h-full",
  "min-h-0",
  "min-w-0",
  "max-w-full",
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "font-normal",
  "font-medium",
  "font-semibold",
  "font-bold",
  "rounded",
  "rounded-md",
  "rounded-lg",
  "rounded-full",
  "border",
  "border-t",
  "shadow",
  "shadow-sm",
  "shadow-md",
  "bg-white",
  "bg-black",
  "bg-transparent",
  "text-white",
  "text-black",
  "truncate",
  "overflow-hidden",
  "overflow-auto",
  "select-none",
  "pointer-events-none",
  "dark:bg-gray-900",
  "hover:opacity-80",
  "hover:bg-black/5",
  "transition",
  "transition-colors",
  "duration-150",
  "cursor-pointer",
];

function keywordSource(context: CompletionContext) {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: [
      ...JS_KEYWORDS.map((label) => ({ label, type: "keyword" as const })),
      ...JS_SNIPPETS,
    ],
    validFor: /^\w*$/,
  };
}

function cssSource(context: CompletionContext) {
  const word = context.matchBefore(/[\w-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: CSS_PROPERTIES.map((label) => ({
      label,
      type: "property" as const,
      detail: "CSS",
    })),
    validFor: /^[\w-]*$/,
  };
}

function tailwindSource(context: CompletionContext) {
  const word = context.matchBefore(/[\w:-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: TAILWIND_CLASSES.map((label) => ({
      label,
      type: "constant" as const,
      detail: "Tailwind",
    })),
    validFor: /^[\w:-]*$/,
  };
}

function sourcesForPath(filePath: string): CompletionSource[] {
  const name = basename(filePath).toLowerCase();
  const isCode =
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".vue") ||
    name.endsWith(".mjs") ||
    name.endsWith(".cjs");
  const isMarkup =
    name.endsWith(".html") ||
    name.endsWith(".vue") ||
    name.endsWith(".jsx") ||
    name.endsWith(".tsx");
  const isCss =
    name.endsWith(".css") ||
    name.endsWith(".scss") ||
    name.endsWith(".sass") ||
    name.endsWith(".less");

  const sources: CompletionSource[] = [completeAnyWord];
  if (isCode) sources.push(keywordSource);
  if (isCss) sources.push(cssSource);
  if (isMarkup) sources.push(tailwindSource);
  return sources;
}

/** 本地语法 / 片段 / 文档词补全（无 AI、无网络） */
export function createCompletionExtension(filePath: string): Extension {
  const sources = sourcesForPath(filePath);
  return [
    autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 32,
      icons: true,
      closeOnBlur: true,
      defaultKeymap: true,
    }),
    // 叠加到语言自带补全上，而不是 override 替换
    EditorState.languageData.of(() =>
      sources.map((autocomplete) => ({ autocomplete })),
    ),
  ];
}
