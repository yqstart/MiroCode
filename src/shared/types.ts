export type ThemeId = "adnify-dark" | "dawn" | "midnight" | "cyberpunk";

export type SidePanelId = "explorer" | "git";

export interface EditorPreferences {
  fontSize: number;
  tabSize: 2 | 4;
  wordWrap: boolean;
  lineNumbers: boolean;
  /** 编辑后延迟自动保存到磁盘 */
  autoSave: boolean;
  /** 自动保存延迟（毫秒） */
  autoSaveDelayMs: number;
}

export interface LayoutState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activePanel: SidePanelId;
}

export interface AppSettings {
  theme: ThemeId;
  locale: "zh-CN" | "en-US";
  editor: EditorPreferences;
  layout: LayoutState;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "adnify-dark",
  locale: "zh-CN",
  editor: {
    fontSize: 13,
    tabSize: 2,
    wordWrap: true,
    lineNumbers: true,
    autoSave: true,
    autoSaveDelayMs: 1000,
  },
  layout: {
    sidebarCollapsed: false,
    sidebarWidth: 260,
    activePanel: "explorer",
  },
};

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  available: boolean;
  preview: "dark" | "light" | "midnight" | "cyber";
}

export interface EditorJumpTarget {
  path: string;
  line: number;
  column: number;
}

export interface EditorOpenAt {
  path: string;
  line: number;
  column: number;
  requestId: number;
}
