export type ThemeId = "miro-dark" | "dawn" | "midnight" | "cyberpunk";

/** 左侧工具窗口：资源管理器 | Commit（WebStorm New UI） */
export type SidePanelId = "explorer" | "commit";

export type UpdateImportsOnMove = "always" | "prompt" | "never";

// ==================== AI 行内智能补全 ====================

/** AI 补全 provider 预设 id */
export type AiProviderId = "deepseek" | "custom";

/** AI 补全配置（非敏感项，随 AppSettings 持久化到 localStorage） */
export interface AiCompletionPrefs {
  /** 总开关 */
  enabled: boolean;
  /** provider 预设 id */
  provider: AiProviderId;
  /** API 基地址（选择预设时自动填充，可覆盖） */
  apiBase: string;
  /** 模型名 */
  model: string;
  /** 防抖延迟（毫秒） */
  debounceMs: number;
  /** prompt token 预算上限 */
  maxPromptTokens: number;
  /** 生成 max_tokens */
  maxTokens: number;
  /** 温度 */
  temperature: number;
  /** 多行补全策略：auto | always | never */
  multiline: "auto" | "always" | "never";
}

export interface EditorPreferences {
  fontSize: number;
  tabSize: 2 | 4;
  wordWrap: boolean;
  lineNumbers: boolean;
  /** 编辑后延迟自动保存到磁盘 */
  autoSave: boolean;
  /** 自动保存延迟（毫秒） */
  autoSaveDelayMs: number;
  /** 启用工作区 ESLint 诊断。需项目已安装 eslint */
  eslintEnabled: boolean;
  /** 启用工作区 Prettier（需项目已安装 prettier） */
  prettierEnabled: boolean;
  /** 移动文件/文件夹后如何更新相对 import 引用 */
  updateImportsOnMove: UpdateImportsOnMove;
  /** 启用 LSP 语言服务（TS/JS/Vue）。需宿主已安装 Node + language server */
  lspEnabled: boolean;
  /** AI 行内智能补全配置 */
  aiCompletion: AiCompletionPrefs;
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
    eslintEnabled: false,
    prettierEnabled: false,
    updateImportsOnMove: "prompt",
    lspEnabled: true,
    aiCompletion: {
      enabled: false,
      provider: "deepseek",
      apiBase: "https://api.deepseek.com/beta",
      model: "deepseek-v4-pro",
      debounceMs: 350,
      maxPromptTokens: 1024,
      maxTokens: 256,
      temperature: 0.2,
      multiline: "auto",
    },
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

/** 查找面板打开请求（原生菜单 ⌘F -> store 信号 -> 编辑器 watcher 消费） */
export interface EditorFindRequest {
  path: string | null;
  requestId: number;
}
