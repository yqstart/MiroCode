import type { ThemeId } from "@/shared/types";
import type { ITheme } from "@xterm/xterm";

/** 终端配色：保证 ANSI 输出在浅/深底上均可读 */
export function terminalThemeColors(theme: ThemeId): ITheme {
  if (theme === "cyberpunk") {
    return {
      background: "#0a0610",
      foreground: "#faf5ff",
      cursor: "#f0abfc",
      cursorAccent: "#0a0610",
      selectionBackground: "rgba(240,171,252,0.32)",
      selectionForeground: "#ffffff",
      black: "#1a1020",
      red: "#fb7185",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#22d3ee",
      magenta: "#e879f9",
      cyan: "#67e8f9",
      white: "#faf5ff",
      brightBlack: "#c4b5fd",
      brightRed: "#fda4af",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde68a",
      brightBlue: "#67e8f9",
      brightMagenta: "#f0abfc",
      brightCyan: "#a5f3fc",
      brightWhite: "#ffffff",
    };
  }
  if (theme === "midnight") {
    return {
      background: "#080e1a",
      foreground: "#f1f5f9",
      cursor: "#38bdf8",
      cursorAccent: "#080e1a",
      selectionBackground: "rgba(56,189,248,0.32)",
      selectionForeground: "#ffffff",
      black: "#0f172a",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#38bdf8",
      magenta: "#a78bfa",
      cyan: "#22d3ee",
      white: "#f1f5f9",
      brightBlack: "#94a3b8",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde68a",
      brightBlue: "#7dd3fc",
      brightMagenta: "#c4b5fd",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    };
  }
  if (theme === "dawn") {
    // 浅底略加深，前景与 ANSI 用深色系，避免「白底 + 浅色输出」发糊
    return {
      background: "#e8ecf1",
      foreground: "#1c1f26",
      cursor: "#2563eb",
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(37,99,235,0.28)",
      selectionForeground: "#0f172a",
      black: "#1c1f26",
      red: "#b91c1c",
      green: "#047857",
      yellow: "#b45309",
      blue: "#1d4ed8",
      magenta: "#7e22ce",
      cyan: "#0e7490",
      white: "#4b5563",
      brightBlack: "#374151",
      brightRed: "#dc2626",
      brightGreen: "#059669",
      brightYellow: "#d97706",
      brightBlue: "#2563eb",
      brightMagenta: "#9333ea",
      brightCyan: "#0891b2",
      brightWhite: "#111827",
    };
  }
  return {
    background: "#0c0c10",
    foreground: "#fafafa",
    cursor: "#8b5cf6",
    cursorAccent: "#0c0c10",
    selectionBackground: "rgba(139,92,246,0.32)",
    selectionForeground: "#ffffff",
    black: "#18181b",
    red: "#f87171",
    green: "#34d399",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#f4f4f5",
    brightBlack: "#a1a1aa",
    brightRed: "#fca5a5",
    brightGreen: "#6ee7b7",
    brightYellow: "#fde68a",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  };
}
