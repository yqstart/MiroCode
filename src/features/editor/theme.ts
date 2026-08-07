import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { ThemeId } from "@/shared/types";

interface ThemePalette {
  bg: string;
  fg: string;
  gutter: string;
  gutterFg: string;
  activeLine: string;
  /** 当前选区：应明显亮于 selectionMatch */
  selection: string;
  /** 与选区相同文本的其它出现：弱提示，不可压过选区 */
  selectionMatch: string;
  caret: string;
  isDark: boolean;
  highlight: HighlightStyle;
}

/** Miro Dark：提高饱和度与明度，避免语法色偏灰发暗 */
const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c792ea" },
  { tag: t.controlKeyword, color: "#c792ea" },
  { tag: t.moduleKeyword, color: "#c792ea" },
  { tag: t.operatorKeyword, color: "#89ddff" },
  { tag: t.string, color: "#c3e88d" },
  { tag: t.special(t.string), color: "#f07178" },
  { tag: t.comment, color: "#a8b4c4", fontStyle: "italic" },
  { tag: t.lineComment, color: "#a8b4c4", fontStyle: "italic" },
  { tag: t.blockComment, color: "#a8b4c4", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#82aaff" },
  { tag: t.definition(t.function(t.variableName)), color: "#82aaff" },
  { tag: t.number, color: "#f78c6c" },
  { tag: t.bool, color: "#f78c6c" },
  { tag: t.null, color: "#f78c6c" },
  { tag: t.propertyName, color: "#ffcb6b" },
  { tag: t.definition(t.propertyName), color: "#ffcb6b" },
  { tag: t.attributeName, color: "#ffcb6b" },
  { tag: t.typeName, color: "#ffcb6b" },
  { tag: t.className, color: "#ffcb6b" },
  { tag: t.namespace, color: "#ffcb6b" },
  { tag: t.operator, color: "#89ddff" },
  { tag: t.punctuation, color: "#89ddff" },
  { tag: t.bracket, color: "#89ddff" },
  { tag: t.tagName, color: "#f07178" },
  { tag: t.angleBracket, color: "#89ddff" },
  { tag: t.regexp, color: "#89ddff" },
  { tag: t.variableName, color: "#eeffff" },
  { tag: t.definition(t.variableName), color: "#eeffff" },
  { tag: t.special(t.variableName), color: "#f07178" },
  { tag: t.literal, color: "#f78c6c" },
  { tag: t.unit, color: "#f78c6c" },
  { tag: t.color, color: "#f78c6c" },
  { tag: t.modifier, color: "#c792ea" },
  { tag: t.labelName, color: "#c792ea" },
  { tag: t.heading, color: "#c792ea", fontWeight: "bold" },
  { tag: t.link, color: "#82aaff", textDecoration: "underline" },
  { tag: t.url, color: "#89ddff" },
  { tag: t.meta, color: "#89ddff" },
  { tag: t.processingInstruction, color: "#89ddff" },
  { tag: t.invalid, color: "#ff5370" },
]);

const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#1d4ed8" },
  { tag: t.controlKeyword, color: "#1e40af" },
  { tag: t.string, color: "#047857" },
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.lineComment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#6d28d9" },
  { tag: t.definition(t.function(t.variableName)), color: "#5b21b6" },
  { tag: t.number, color: "#c2410c" },
  { tag: t.bool, color: "#b45309" },
  { tag: t.null, color: "#b45309" },
  { tag: t.propertyName, color: "#0e7490" },
  { tag: t.definition(t.propertyName), color: "#155e75" },
  { tag: t.typeName, color: "#1e40af" },
  { tag: t.className, color: "#1e3a8a" },
  { tag: t.operator, color: "#374151" },
  { tag: t.punctuation, color: "#6b7280" },
  { tag: t.bracket, color: "#4b5563" },
  { tag: t.tagName, color: "#1d4ed8" },
  { tag: t.attributeName, color: "#0f766e" },
  { tag: t.regexp, color: "#a21caf" },
  { tag: t.variableName, color: "#1c1c21" },
  { tag: t.definition(t.variableName), color: "#111827" },
  { tag: t.special(t.variableName), color: "#7c3aed" },
  { tag: t.unit, color: "#c2410c" },
  { tag: t.color, color: "#c2410c" },
  { tag: t.modifier, color: "#1d4ed8" },
  { tag: t.heading, color: "#1d4ed8", fontWeight: "bold" },
  { tag: t.link, color: "#2563eb", textDecoration: "underline" },
  { tag: t.url, color: "#0284c7" },
  { tag: t.meta, color: "#6b7280" },
  { tag: t.invalid, color: "#dc2626" },
]);

const midnightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#7dd3fc" },
  { tag: t.controlKeyword, color: "#38bdf8" },
  { tag: t.string, color: "#6ee7b7" },
  { tag: t.comment, color: "#94a3b8", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#93c5fd" },
  { tag: t.definition(t.function(t.variableName)), color: "#bfdbfe" },
  { tag: t.number, color: "#fcd34d" },
  { tag: t.bool, color: "#fde68a" },
  { tag: t.null, color: "#fde68a" },
  { tag: t.propertyName, color: "#bae6fd" },
  { tag: t.typeName, color: "#a5b4fc" },
  { tag: t.className, color: "#a5b4fc" },
  { tag: t.operator, color: "#cbd5e1" },
  { tag: t.punctuation, color: "#94a3b8" },
  { tag: t.tagName, color: "#7dd3fc" },
  { tag: t.attributeName, color: "#67e8f9" },
  { tag: t.regexp, color: "#f9a8d4" },
  { tag: t.variableName, color: "#e2e8f0" },
  { tag: t.unit, color: "#fcd34d" },
  { tag: t.color, color: "#fcd34d" },
  { tag: t.invalid, color: "#f87171" },
]);

const cyberHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#f472b6" },
  { tag: t.controlKeyword, color: "#fb7185" },
  { tag: t.string, color: "#34d399" },
  { tag: t.comment, color: "#a78bfa", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#22d3ee" },
  { tag: t.definition(t.function(t.variableName)), color: "#67e8f9" },
  { tag: t.number, color: "#fbbf24" },
  { tag: t.bool, color: "#fcd34d" },
  { tag: t.null, color: "#fcd34d" },
  { tag: t.propertyName, color: "#e879f9" },
  { tag: t.typeName, color: "#67e8f9" },
  { tag: t.className, color: "#67e8f9" },
  { tag: t.operator, color: "#e9d5ff" },
  { tag: t.punctuation, color: "#c4b5fd" },
  { tag: t.tagName, color: "#f472b6" },
  { tag: t.attributeName, color: "#a78bfa" },
  { tag: t.regexp, color: "#fb7185" },
  { tag: t.variableName, color: "#f5f3ff" },
  { tag: t.unit, color: "#fbbf24" },
  { tag: t.color, color: "#fbbf24" },
  { tag: t.invalid, color: "#fb7185" },
]);

const PALETTES: Record<ThemeId, ThemePalette> = {
  "miro-dark": {
    bg: "#0f0f12",
    fg: "#f5f8ff",
    gutter: "#16161a",
    gutterFg: "#a1a1aa",
    activeLine: "rgba(139,92,246,0.08)",
    selection: "rgba(167,139,250,0.55)",
    selectionMatch: "rgba(167,139,250,0.18)",
    caret: "#8b5cf6",
    isDark: true,
    highlight: darkHighlight,
  },
  dawn: {
    bg: "#ffffff",
    fg: "#111114",
    gutter: "#fafbfc",
    gutterFg: "#71717a",
    activeLine: "rgba(37,99,235,0.06)",
    selection: "rgba(37,99,235,0.35)",
    selectionMatch: "rgba(37,99,235,0.12)",
    caret: "#2563eb",
    isDark: false,
    highlight: lightHighlight,
  },
  midnight: {
    bg: "#0b1220",
    fg: "#f1f5f9",
    gutter: "#0f172a",
    gutterFg: "#94a3b8",
    activeLine: "rgba(56,189,248,0.08)",
    selection: "rgba(56,189,248,0.48)",
    selectionMatch: "rgba(56,189,248,0.16)",
    caret: "#38bdf8",
    isDark: true,
    highlight: midnightHighlight,
  },
  cyberpunk: {
    bg: "#120a16",
    fg: "#faf5ff",
    gutter: "#1a1020",
    gutterFg: "#c4b5fd",
    activeLine: "rgba(244,114,182,0.1)",
    selection: "rgba(34,211,238,0.45)",
    selectionMatch: "rgba(34,211,238,0.16)",
    caret: "#22d3ee",
    isDark: true,
    highlight: cyberHighlight,
  },
};

function uiTheme(palette: ThemePalette): Extension {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: palette.bg,
        color: palette.fg,
        fontSize: "inherit",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        lineHeight: "1.65",
      },
      ".cm-content": {
        caretColor: palette.caret,
        paddingBottom: "40vh",
        userSelect: "text",
        WebkitUserSelect: "text",
      },
      ".cm-gutters": {
        backgroundColor: palette.gutter,
        color: palette.gutterFg,
        border: "none",
        borderRight: "1px solid var(--border-subtle)",
      },
      ".cm-activeLine": {
        backgroundColor: palette.activeLine,
      },
      ".cm-activeLineGutter": {
        backgroundColor: palette.activeLine,
        color: palette.fg,
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
        {
          backgroundColor: palette.selection,
        },
      /* 相同文本其它出现：弱于当前选区，避免「选中反而更暗」 */
      ".cm-selectionMatch": {
        backgroundColor: palette.selectionMatch,
      },
      ".cm-selectionMatch.cm-selectionBackground, &.cm-focused .cm-selectionMatch.cm-selectionBackground":
        {
          backgroundColor: palette.selection,
        },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: palette.caret,
      },
      ".cm-lintRange-error": {
        backgroundImage: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"6\" height=\"3\"><path d=\"m0 3 l2 -2 l1 0 l2 2\" fill=\"%23f87171\"/></svg>')",
      },
      ".cm-lintRange-warning": {
        backgroundImage: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"6\" height=\"3\"><path d=\"m0 3 l2 -2 l1 0 l2 2\" fill=\"%23fbbf24\"/></svg>')",
      },
    },
    { dark: palette.isDark },
  );
}

export function editorThemeExtensions(theme: ThemeId): Extension[] {
  const palette = PALETTES[theme];
  return [
    uiTheme(palette),
    syntaxHighlighting(palette.highlight, { fallback: true }),
  ];
}

export const THEME_LABELS: Record<ThemeId, string> = {
  "miro-dark": "Miro Dark",
  dawn: "Miro Dawn",
  midnight: "Miro Midnight",
  cyberpunk: "Miro Cyberpunk",
};

/** 状态栏快捷切换顺序 */
export const THEME_ORDER: ThemeId[] = [
  "miro-dark",
  "dawn",
  "midnight",
  "cyberpunk",
];
