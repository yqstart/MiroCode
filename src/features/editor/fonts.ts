import type { EditorFontId } from "@/shared/types";

/** 编辑器专用字体栈；第三方字体未安装时由浏览器按顺序自动回退。 */
export const EDITOR_FONT_FAMILIES: Record<EditorFontId, string> = {
  system:
    'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, "PingFang SC", monospace',
  jetbrains:
    '"JetBrains Mono", "SF Mono", Menlo, Monaco, "PingFang SC", monospace',
  sarasa:
    '"Sarasa Mono SC", "更纱等宽黑体 SC", "PingFang SC", monospace',
  cascadia:
    '"Cascadia Code", "Cascadia Mono", "SF Mono", Menlo, Monaco, "PingFang SC", monospace',
};

export const EDITOR_FONT_OPTIONS = [
  { id: "system", labelKey: "settings.fontSystem" },
  { id: "jetbrains", labelKey: "settings.fontJetBrains" },
  { id: "sarasa", labelKey: "settings.fontSarasa" },
  { id: "cascadia", labelKey: "settings.fontCascadia" },
] as const satisfies ReadonlyArray<{
  id: EditorFontId;
  labelKey: string;
}>;

export function getEditorFontFamily(font: EditorFontId): string {
  return EDITOR_FONT_FAMILIES[font] ?? EDITOR_FONT_FAMILIES.system;
}
