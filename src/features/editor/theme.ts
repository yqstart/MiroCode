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
  selection: string;
  caret: string;
  isDark: boolean;
  highlight: HighlightStyle;
}

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c4b5fd" },
  { tag: t.controlKeyword, color: "#d8b4fe" },
  { tag: t.string, color: "#86efac" },
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.lineComment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#a5b4fc" },
  { tag: t.definition(t.function(t.variableName)), color: "#c7d2fe" },
  { tag: t.number, color: "#fbbf24" },
  { tag: t.bool, color: "#fcd34d" },
  { tag: t.null, color: "#fcd34d" },
  { tag: t.propertyName, color: "#ddd6fe" },
  { tag: t.definition(t.propertyName), color: "#e9d5ff" },
  { tag: t.typeName, color: "#93c5fd" },
  { tag: t.className, color: "#93c5fd" },
  { tag: t.operator, color: "#e4e4e7" },
  { tag: t.punctuation, color: "#a1a1aa" },
  { tag: t.bracket, color: "#d4d4d8" },
  { tag: t.tagName, color: "#c4b5fd" },
  { tag: t.attributeName, color: "#7dd3fc" },
  { tag: t.regexp, color: "#f9a8d4" },
  { tag: t.variableName, color: "#e4e4e7" },
  { tag: t.definition(t.variableName), color: "#f4f4f5" },
  { tag: t.special(t.variableName), color: "#f0abfc" },
  { tag: t.heading, color: "#c4b5fd", fontWeight: "bold" },
  { tag: t.link, color: "#93c5fd", textDecoration: "underline" },
  { tag: t.url, color: "#7dd3fc" },
  { tag: t.meta, color: "#a1a1aa" },
  { tag: t.invalid, color: "#f87171" },
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
  { tag: t.comment, color: "#64748b", fontStyle: "italic" },
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
  { tag: t.invalid, color: "#f87171" },
]);

const cyberHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#f472b6" },
  { tag: t.controlKeyword, color: "#fb7185" },
  { tag: t.string, color: "#34d399" },
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
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
  { tag: t.invalid, color: "#fb7185" },
]);

const PALETTES: Record<ThemeId, ThemePalette> = {
  "miro-dark": {
    bg: "#0f0f12",
    fg: "#f4f4f5",
    gutter: "#16161a",
    gutterFg: "#71717a",
    activeLine: "rgba(139,92,246,0.08)",
    selection: "rgba(139,92,246,0.28)",
    caret: "#8b5cf6",
    isDark: true,
    highlight: darkHighlight,
  },
  dawn: {
    bg: "#ffffff",
    fg: "#1c1c21",
    gutter: "#fafbfc",
    gutterFg: "#9a9aa3",
    activeLine: "rgba(37,99,235,0.06)",
    selection: "rgba(37,99,235,0.18)",
    caret: "#2563eb",
    isDark: false,
    highlight: lightHighlight,
  },
  midnight: {
    bg: "#0b1220",
    fg: "#e2e8f0",
    gutter: "#0f172a",
    gutterFg: "#64748b",
    activeLine: "rgba(56,189,248,0.08)",
    selection: "rgba(56,189,248,0.24)",
    caret: "#38bdf8",
    isDark: true,
    highlight: midnightHighlight,
  },
  cyberpunk: {
    bg: "#120a16",
    fg: "#f5f3ff",
    gutter: "#1a1020",
    gutterFg: "#9ca3af",
    activeLine: "rgba(244,114,182,0.1)",
    selection: "rgba(34,211,238,0.22)",
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
  return [uiTheme(palette), syntaxHighlighting(palette.highlight)];
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
