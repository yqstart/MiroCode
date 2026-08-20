import type { ThemeId } from "@/shared/types";
import type { ITheme } from "@xterm/xterm";

/** 终端配色：保证 ANSI 输出在浅/深底上均可读 */
export function terminalThemeColors(theme: ThemeId): ITheme {
  if (theme === "cyberpunk") {
    return {
      background: "#0a0b10",
      foreground: "#f7f5fb",
      cursor: "#63e6f3",
      cursorAccent: "#0a0b10",
      selectionBackground: "rgba(99,230,243,0.28)",
      selectionForeground: "#ffffff",
      black: "#17151f",
      red: "#fb7185",
      green: "#34d399",
      yellow: "#f6c453",
      blue: "#63e6f3",
      magenta: "#e785ff",
      cyan: "#67e8f9",
      white: "#f7f5fb",
      brightBlack: "#8c869b",
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
      background: "#0a1020",
      foreground: "#f1f5f9",
      cursor: "#66c7f3",
      cursorAccent: "#0a1020",
      selectionBackground: "rgba(102,199,243,0.28)",
      selectionForeground: "#ffffff",
      black: "#141c2b",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#66c7f3",
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
      background: "#eef0f3",
      foreground: "#20242d",
      cursor: "#4f6fe8",
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(79,111,232,0.24)",
      selectionForeground: "#20242d",
      black: "#20242d",
      red: "#b91c1c",
      green: "#047857",
      yellow: "#b45309",
      blue: "#3f5fd4",
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
    background: "#0b0c10",
    foreground: "#f4f4f5",
    cursor: "#a78bfa",
    cursorAccent: "#0b0c10",
    selectionBackground: "rgba(167,139,250,0.28)",
    selectionForeground: "#ffffff",
    black: "#17181c",
    red: "#f87171",
    green: "#34d399",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c4a7ff",
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
