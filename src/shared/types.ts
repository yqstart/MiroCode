export type ThemeId = "miro-dark" | "dawn" | "midnight" | "cyberpunk";

/** 左侧工具窗口：资源管理器 | Commit（WebStorm New UI） */
export type SidePanelId = "explorer" | "commit";

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

/** 历史兼容：曾用底栏 Git Log 高度；现 Git Log 为编辑区标签，open 不再驱动布局 */
export interface GitLogWindowState {
  open: boolean;
  height: number;
}

export interface LayoutState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activePanel: SidePanelId;
  gitLogWindow: GitLogWindowState;
}

export interface AppSettings {
  theme: ThemeId;
  locale: "zh-CN" | "en-US";
  editor: EditorPreferences;
  layout: LayoutState;
  /** 启动时自动检查 GitHub Release 更新 */
  autoCheckUpdates: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "miro-dark",
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
    sidebarWidth: 300,
    activePanel: "explorer",
    gitLogWindow: {
      open: false,
      height: 280,
    },
  },
  autoCheckUpdates: true,
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
