export type ThemeId = "adnify-dark" | "dawn" | "midnight" | "cyberpunk";

export type SidePanelId = "explorer" | "git";

export interface EditorPreferences {
  fontSize: number;
  tabSize: 2 | 4;
  wordWrap: boolean;
  lineNumbers: boolean;
}

export interface AiCompletionSettings {
  enabled: boolean;
  delayMs: number;
  maxTokens: number;
  triggerChars: string;
}

export interface AiProviderSettings {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AgentSettings {
  enabled: boolean;
  systemPrompt: string;
}

export interface McpServerSettings {
  id: string;
  name: string;
  command: string;
  enabled: boolean;
}

export interface AiSettings {
  completion: AiCompletionSettings;
  providers: AiProviderSettings[];
  activeProviderId: string;
  agent: AgentSettings;
  mcpServers: McpServerSettings[];
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
  ai: AiSettings;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  completion: {
    enabled: false,
    delayMs: 300,
    maxTokens: 128,
    triggerChars: ".",
  },
  providers: [
    {
      id: "local",
      name: "本地占位",
      baseUrl: "",
      apiKey: "",
      model: "placeholder",
    },
  ],
  activeProviderId: "local",
  agent: {
    enabled: false,
    systemPrompt: "你是 Miro Code 内置智能体占位。",
  },
  mcpServers: [],
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "adnify-dark",
  locale: "zh-CN",
  editor: {
    fontSize: 13,
    tabSize: 2,
    wordWrap: true,
    lineNumbers: true,
  },
  layout: {
    sidebarCollapsed: false,
    sidebarWidth: 260,
    activePanel: "explorer",
  },
  ai: structuredClone(DEFAULT_AI_SETTINGS),
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
