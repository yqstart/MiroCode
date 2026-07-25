import {
  autocompletion,
  completeFromList,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
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
  "async",
  "await",
  "class",
  "extends",
  "new",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "interface",
  "type",
  "enum",
];

const JS_SNIPPETS: Completion[] = [
  { label: "log", type: "keyword", detail: "console.log", apply: "console.log($0)" },
  { label: "fn", type: "keyword", detail: "function", apply: "function ${1:name}($2) {\n  $0\n}" },
  { label: "afn", type: "keyword", detail: "async function", apply: "async function ${1:name}($2) {\n  $0\n}" },
  { label: "imp", type: "keyword", detail: "import", apply: "import { $1 } from '$2';" },
];

const TAILWIND_CLASSES = [
  "flex",
  "grid",
  "block",
  "inline",
  "hidden",
  "items-center",
  "justify-center",
  "justify-between",
  "gap-2",
  "gap-4",
  "p-2",
  "p-4",
  "px-4",
  "py-2",
  "m-2",
  "mt-4",
  "mb-4",
  "w-full",
  "h-full",
  "text-sm",
  "text-base",
  "text-lg",
  "font-bold",
  "font-medium",
  "rounded",
  "rounded-lg",
  "border",
  "shadow",
  "bg-white",
  "bg-black",
  "text-white",
  "text-black",
  "dark:bg-gray-900",
  "hover:opacity-80",
  "transition",
  "cursor-pointer",
];

function tailwindSource(context: CompletionContext) {
  const word = context.matchBefore(/[\w:-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: TAILWIND_CLASSES.map((label) => ({
      label,
      type: "constant",
      detail: "Tailwind",
    })),
  };
}

function keywordSource(context: CompletionContext) {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const options: Completion[] = [
    ...JS_KEYWORDS.map((label) => ({ label, type: "keyword" as const })),
    ...JS_SNIPPETS,
  ];
  return { from: word.from, options };
}

export function createCompletionExtension(filePath: string): Extension {
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

  const sources = [];
  if (isCode) {
    sources.push(completeFromList(JS_KEYWORDS.map((k) => ({ label: k, type: "keyword" }))));
    sources.push(keywordSource);
  }
  if (isMarkup) {
    sources.push(tailwindSource);
  }

  return autocompletion({
    override: sources.length ? sources : undefined,
    activateOnTyping: true,
    maxRenderedOptions: 24,
  });
}
