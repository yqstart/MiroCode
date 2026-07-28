import { computed, reactive, watch } from "vue";
import { defineStore } from "pinia";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type EditorPreferences,
  type SidePanelId,
  type ThemeId,
} from "@/shared/types";

const STORAGE_KEY = "mirocode.settings.v1";

/** 历史主题 ID → 现行 ID（曾用名 miro-dark 的旧键） */
const THEME_MIGRATION: Record<string, ThemeId> = {
  "adnify-dark": "miro-dark",
};

/** 各主题对应的 macOS Overlay 标题栏底色（仅最顶系统栏，不含项目行） */
const TITLEBAR_RGB: Record<ThemeId, [number, number, number]> = {
  dawn: [232, 234, 239],
  "miro-dark": [26, 26, 32],
  midnight: [17, 24, 39],
  cyberpunk: [31, 19, 40],
};

function isDarkTheme(theme: ThemeId): boolean {
  return (
    theme === "miro-dark" ||
    theme === "midnight" ||
    theme === "cyberpunk"
  );
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { ai?: unknown };
    const layout = { ...DEFAULT_SETTINGS.layout, ...parsed.layout };
    // 全局搜索已改为 WebStorm 弹层，旧配置中的 search 面板回退到资源管理器
    if ((layout.activePanel as string) === "search") {
      layout.activePanel = "explorer";
    }
    const rawTheme = parsed.theme as string | undefined;
    const theme =
      (rawTheme && THEME_MIGRATION[rawTheme]) ||
      (rawTheme as ThemeId | undefined) ||
      DEFAULT_SETTINGS.theme;
    // 丢弃历史 AI/Agent/MCP 占位字段，不再持久化
    return {
      theme: theme === "dawn" || theme === "miro-dark" || theme === "midnight" || theme === "cyberpunk"
        ? theme
        : DEFAULT_SETTINGS.theme,
      locale: parsed.locale ?? DEFAULT_SETTINGS.locale,
      editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
      layout,
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/** 同步原生标题栏 / 窗口控件外观（macOS 上主题为应用级） */
async function syncNativeWindowTheme(theme: ThemeId) {
  const mode = isDarkTheme(theme) ? "dark" : "light";
  try {
    // macOS / Linux：应用级主题，直接影响标题栏控件外观
    const { setTheme } = await import("@tauri-apps/api/app");
    await setTheme(mode);
  } catch {
    // 纯 Vite 预览或权限未就绪
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(mode);
  } catch {
    // 同上
  }
  // macOS Overlay 标题栏：只给最顶系统栏上色，并补齐红绿灯（setTheme 会重置位置）
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const [r, g, b] = TITLEBAR_RGB[theme];
    await invoke("set_titlebar_background", { r, g, b });
    await invoke("sync_traffic_lights");
  } catch {
    // 非桌面壳或命令未就绪
  }
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
}

export const useSettingsStore = defineStore("settings", () => {
  const settings = reactive<AppSettings>(loadSettings());
  applyTheme(settings.theme);
  void syncNativeWindowTheme(settings.theme);

  watch(
    () => settings.theme,
    (theme) => {
      applyTheme(theme);
      void syncNativeWindowTheme(theme);
    },
  );

  watch(
    settings,
    () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    },
    { deep: true },
  );

  const theme = computed(() => settings.theme);
  const locale = computed(() => settings.locale);
  const editor = computed(() => settings.editor);
  const layout = computed(() => settings.layout);
  const isDark = computed(() => isDarkTheme(settings.theme));

  function setTheme(next: ThemeId) {
    settings.theme = next;
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

  return {
    settings,
    theme,
    locale,
    editor,
    layout,
    isDark,
    setTheme,
    patchEditor,
    setSidebarCollapsed,
    setSidebarWidth,
    setActivePanel,
    toggleSidebar,
    setLocale,
  };
});
