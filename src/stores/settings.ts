import { computed, reactive, watch } from "vue";
import { defineStore } from "pinia";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SETTINGS,
  type AiCompletionSettings,
  type AiSettings,
  type AppSettings,
  type EditorPreferences,
  type SidePanelId,
  type ThemeId,
} from "@/shared/types";

const STORAGE_KEY = "mirocode.settings.v1";

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const layout = { ...DEFAULT_SETTINGS.layout, ...parsed.layout };
    // 全局搜索已改为 WebStorm 弹层，旧配置中的 search 面板回退到资源管理器
    if ((layout.activePanel as string) === "search") {
      layout.activePanel = "explorer";
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
      layout,
      ai: {
        ...DEFAULT_AI_SETTINGS,
        ...parsed.ai,
        completion: {
          ...DEFAULT_AI_SETTINGS.completion,
          ...parsed.ai?.completion,
        },
        agent: { ...DEFAULT_AI_SETTINGS.agent, ...parsed.ai?.agent },
        providers: parsed.ai?.providers ?? DEFAULT_AI_SETTINGS.providers,
        mcpServers: parsed.ai?.mcpServers ?? DEFAULT_AI_SETTINGS.mcpServers,
      },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
}

export const useSettingsStore = defineStore("settings", () => {
  const settings = reactive<AppSettings>(loadSettings());
  applyTheme(settings.theme);

  watch(
    settings,
    () => {
      applyTheme(settings.theme);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    },
    { deep: true },
  );

  const theme = computed(() => settings.theme);
  const locale = computed(() => settings.locale);
  const editor = computed(() => settings.editor);
  const layout = computed(() => settings.layout);
  const isDark = computed(
    () =>
      settings.theme === "adnify-dark" ||
      settings.theme === "midnight" ||
      settings.theme === "cyberpunk",
  );

  function setTheme(next: ThemeId) {
    settings.theme = next;
  }

  function patchAi(patch: Partial<AiSettings>) {
    Object.assign(settings.ai, patch);
  }

  function patchAiCompletion(patch: Partial<AiCompletionSettings>) {
    Object.assign(settings.ai.completion, patch);
  }

  function patchEditor(patch: Partial<EditorPreferences>) {
    Object.assign(settings.editor, patch);
  }

  function setSidebarCollapsed(collapsed: boolean) {
    settings.layout.sidebarCollapsed = collapsed;
  }

  function setSidebarWidth(width: number) {
    settings.layout.sidebarWidth = Math.min(480, Math.max(180, width));
  }

  function setActivePanel(panel: SidePanelId) {
    settings.layout.activePanel = panel;
    if (settings.layout.sidebarCollapsed) {
      settings.layout.sidebarCollapsed = false;
    }
  }

  function toggleSidebar() {
    settings.layout.sidebarCollapsed = !settings.layout.sidebarCollapsed;
  }

  function setLocale(next: AppSettings["locale"]) {
    settings.locale = next;
  }

  const ai = computed(() => settings.ai);

  return {
    settings,
    theme,
    locale,
    editor,
    layout,
    ai,
    isDark,
    setTheme,
    patchAi,
    patchAiCompletion,
    patchEditor,
    setSidebarCollapsed,
    setSidebarWidth,
    setActivePanel,
    toggleSidebar,
    setLocale,
  };
});
