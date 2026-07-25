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
  { tag: t.string, color: "#86efac" },
  { tag: t.comment, color: "#71717a", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#a5b4fc" },
  { tag: t.number, color: "#fbbf24" },
  { tag: t.bool, color: "#fbbf24" },
  { tag: t.null, color: "#fbbf24" },
  { tag: t.propertyName, color: "#ddd6fe" },
  { tag: t.typeName, color: "#93c5fd" },
  { tag: t.className, color: "#93c5fd" },
  { tag: t.operator, color: "#e4e4e7" },
  { tag: t.punctuation, color: "#a1a1aa" },
  { tag: t.tagName, color: "#c4b5fd" },
  { tag: t.attributeName, color: "#93c5fd" },
]);

const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#2563eb" },
  { tag: t.string, color: "#059669" },
  { tag: t.comment, color: "#71717a", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#4f46e5" },
  { tag: t.number, color: "#d97706" },
  { tag: t.bool, color: "#d97706" },
  { tag: t.null, color: "#d97706" },
  { tag: t.propertyName, color: "#0f766e" },
  { tag: t.typeName, color: "#1d4ed8" },
  { tag: t.className, color: "#1d4ed8" },
  { tag: t.operator, color: "#3f3f46" },
  { tag: t.punctuation, color: "#71717a" },
  { tag: t.tagName, color: "#2563eb" },
  { tag: t.attributeName, color: "#0f766e" },
]);

const midnightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#7dd3fc" },
  { tag: t.string, color: "#6ee7b7" },
  { tag: t.comment, color: "#64748b", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#93c5fd" },
  { tag: t.number, color: "#fcd34d" },
  { tag: t.propertyName, color: "#bae6fd" },
  { tag: t.typeName, color: "#a5b4fc" },
  { tag: t.tagName, color: "#7dd3fc" },
]);

const cyberHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#f472b6" },
  { tag: t.string, color: "#34d399" },
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.function(t.variableName), color: "#22d3ee" },
  { tag: t.number, color: "#fbbf24" },
  { tag: t.propertyName, color: "#e879f9" },
  { tag: t.typeName, color: "#67e8f9" },
  { tag: t.tagName, color: "#f472b6" },
]);

const PALETTES: Record<ThemeId, ThemePalette> = {
  "adnify-dark": {
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
    bg: "#f4f5f7",
    fg: "#18181b",
    gutter: "#ffffff",
    gutterFg: "#a1a1aa",
    activeLine: "rgba(59,130,246,0.08)",
    selection: "rgba(59,130,246,0.22)",
    caret: "#3b82f6",
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
  "adnify-dark": "Adnify Dark",
  dawn: "Dawn",
  midnight: "Midnight",
  cyberpunk: "Cyberpunk",
};
