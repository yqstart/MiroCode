<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import { Check, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { THEME_LABELS } from "@/features/editor/theme";
import { checkForAppUpdate, getAppVersion } from "@/shared/appUpdate";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { formatShortcut } from "@/shared/platform";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import type { ThemeId, ThemeMeta, AiProviderId } from "@/shared/types";
import { useI18n } from "@/i18n";
import { PROVIDER_PRESETS, getPreset } from "@/features/ai/providers";
import { getAiApiKey, setAiApiKey } from "@/shared/aiApi";
import { lsInstaller } from "@/features/lsp/installer";
import type { LsMirror } from "@/features/lsp/types";

const { t } = useI18n();
const settings = useSettingsStore();
const ui = useUiStore();
const workspace = useWorkspaceStore();
const { theme, editor, locale } = storeToRefs(settings);

type NavId = "editor" | "ai" | "shortcuts" | "system";

const activeNav = ref<NavId>(ui.settingsNav);
const appVersion = ref("…");
const checkingUpdate = ref(false);

onMounted(async () => {
  appVersion.value = await getAppVersion();
});

// ==================== LSP 语言服务 ====================

import type { LanguageId } from "@/features/lsp/types";

const lspRuntimeStatus = ref("");
/** 各语言的安装器状态（按语言独立） */
const lsStates = ref<Record<string, import("@/features/lsp/installer").InstallerState>>({
  ts: lsInstaller.getState("ts"),
  vue: lsInstaller.getState("vue"),
});
const lsMirror = ref<LsMirror>("auto");
const lsCustomBase = ref("");

/** 镜像源选项 */
const lsMirrorOptions = computed(() => [
  { id: "auto" as LsMirror, label: t("lsp.mirrorAuto") },
  { id: "github" as LsMirror, label: t("lsp.mirrorGithub") },
  { id: "ghproxy" as LsMirror, label: t("lsp.mirrorGhproxy") },
  { id: "custom" as LsMirror, label: t("lsp.mirrorCustom") },
]);

/** 语言服务列表条目（每语言独立状态） */
const lsItems = computed(() => {
  const defs = [
    { key: "ts" as LanguageId, name: t("lsp.lsTypeScript"), desc: t("lsp.lsTypeScriptDesc") },
    { key: "vue" as LanguageId, name: t("lsp.lsVue"), desc: t("lsp.lsVueDesc") },
  ];
  return defs.map((it) => {
    const st = lsStates.value[it.key];
    const installed = st?.status?.installedVersion ?? null;
    const hasUpdate = st?.status?.hasUpdate ?? false;
    const latest = st?.status?.latestVersion ?? null;
    const busy = st?.busy ?? false;
    const phase = st?.phase ?? "idle";
    const percent = st?.percent ?? 0;
    const badge = installed ? (hasUpdate ? "update" : "installed") : "not-installed";
    return { ...it, installed, hasUpdate, latest, badge, busy, phase, percent };
  });
});

/** 镜像连通状态文案与颜色类（从 TS 语言的状态读取，镜像连通性所有语言共享） */
const lsMirrorStatus = computed<{ text: string; cls: string }>(() => {
  const st = lsStates.value.ts?.status;
  if (!st) return { text: t("lsp.mirrorChecking"), cls: "ms-checking" };
  if (st.latestAvailable) {
    const map: Record<string, string> = {
      github: t("lsp.mirrorOkGithub"),
      ghproxy: t("lsp.mirrorOkGhproxy"),
      custom: t("lsp.mirrorOkCustom"),
    };
    return { text: map[st.mirrorUsed] ?? t("lsp.mirrorOkGithub"), cls: "ms-ok" };
  }
  return { text: t("lsp.mirrorFail"), cls: "ms-fail" };
});

/** 安装进度阶段文案 */
function lsPhaseTextFor(language: LanguageId): string {
  const labels: Record<string, string> = {
    manifest: t("lsp.phaseManifest"),
    download: t("lsp.phaseDownload"),
    verify: t("lsp.phaseVerify"),
    extract: t("lsp.phaseExtract"),
    done: t("lsp.phaseDone"),
  };
  const phase = lsStates.value[language]?.phase ?? "idle";
  return labels[phase] ?? "";
}

/** LSP 分区功能可用性：语言服务已安装，或宿主 Node + server 就绪 */
async function updateLspStatus() {
  try {
    const { detectRuntime } = await import("@/features/lsp/nodeDetector");
    const r = await detectRuntime();
    if (r.bundledVersion) {
      lspRuntimeStatus.value = `${t("lsp.bundleReady")} ${r.bundledVersion}`;
      return;
    }
    if (!r.node) {
      lspRuntimeStatus.value = t("lsp.runtimeNoNode");
    } else if (!r.tsLs && !r.volar) {
      lspRuntimeStatus.value = t("lsp.runtimeNoServer");
    } else {
      const parts: string[] = [];
      if (r.tsLs) parts.push("typescript-language-server");
      if (r.volar) parts.push("vue-language-server");
      lspRuntimeStatus.value = t("lsp.runtimeReady") + parts.join(" / ");
    }
  } catch {
    lspRuntimeStatus.value = t("lsp.runtimeUnknown");
  }
}

async function toggleLsp(enabled: boolean) {
  settings.patchEditor({ lspEnabled: enabled });
  const { lspManager } = await import("@/features/lsp/manager");
  lspManager.setEnabled(enabled);
  if (enabled && workspace.rootPath) {
    void lspManager.start(workspace.rootPath);
  }
  void updateLspStatus();
}

/** 刷新所有语言服务状态（远端清单 + 本地安装版本） */
async function refreshLsStatus() {
  await Promise.all([
    lsInstaller.refresh("ts", lsMirror.value, lsCustomBase.value || null),
    lsInstaller.refresh("vue", lsMirror.value, lsCustomBase.value || null),
  ]);
  void updateLspStatus();
}

/** 安装 / 更新指定语言 */
async function installLanguageService(language: LanguageId) {
  const ok = await lsInstaller.install(language, lsMirror.value, lsCustomBase.value || null);
  if (!ok) {
    const err = lsInstaller.getState(language).error ?? "";
    workspace.showNotice(t("lsp.installFailed", { message: err }));
    return;
  }
  const ver = lsInstaller.getState(language).status?.installedVersion ?? "";
  workspace.showNotice(t("lsp.installed", { version: ver }));
  // 安装完成后重启工作区 LSP，立即使用新安装的语言服务。
  // 关键：先清掉 nodeDetector 的 cached 运行时检测结果（否则会拿到安装前的
  // node:false 一直降级到 unavailable），再 stop+start 让 start() 重新检测。
  const { clearRuntimeCache } = await import("@/features/lsp/nodeDetector");
  const { lspManager } = await import("@/features/lsp/manager");
  clearRuntimeCache();
  if (workspace.rootPath) {
    await lspManager.stop();
    await lspManager.start(workspace.rootPath);
  }
  void updateLspStatus();
}

/** 卸载指定语言 */
async function uninstallLanguageService(language: LanguageId) {
  const ok = await lsInstaller.uninstall(language);
  if (!ok) {
    const err = lsInstaller.getState(language).error ?? "";
    workspace.showNotice(t("lsp.uninstallFailed", { message: err }));
    return;
  }
  workspace.showNotice(t("lsp.uninstalled"));
  // 卸载后清缓存 + 重启 LSP，让运行时检测拿到最新路径。
  const { clearRuntimeCache } = await import("@/features/lsp/nodeDetector");
  const { lspManager } = await import("@/features/lsp/manager");
  clearRuntimeCache();
  if (workspace.rootPath) {
    await lspManager.stop();
    await lspManager.start(workspace.rootPath);
  }
  void updateLspStatus();
}

/** 切换镜像源后重新拉取状态 */
function onMirrorChange() {
  void refreshLsStatus();
}

onMounted(async () => {
  lsStates.value = {
    ts: lsInstaller.getState("ts"),
    vue: lsInstaller.getState("vue"),
  };
  const unsub = lsInstaller.subscribe((language, state) => {
    lsStates.value = { ...lsStates.value, [language]: state };
  });
  onScopeDispose(unsub);
  await refreshLsStatus();
});

// 设置页打开时检测运行时
void updateLspStatus();

async function onCheckUpdate() {
  if (checkingUpdate.value) return;
  checkingUpdate.value = true;
  try {
    await checkForAppUpdate("manual", (message) => {
      workspace.showNotice(message);
    });
  } finally {
    checkingUpdate.value = false;
  }
}

// ==================== AI 行内补全 ====================

const aiPrefs = computed(() => editor.value.aiCompletion);
const aiKeyInput = ref("");
const aiKeyLoaded = ref(false);
const aiKeyMasked = ref("");
const testingConnection = ref(false);

/** provider 选项 */
const providerOptions = computed(() =>
  PROVIDER_PRESETS.map((p) => ({ id: p.id, label: p.label })),
);

/** 当前 API Key 掩码显示 */
const aiKeyDisplay = computed(() => aiKeyMasked.value || aiKeyInput.value);

/** 切换 provider 时自动填充 apiBase/model */
function onProviderChange(providerId: AiProviderId) {
  const preset = getPreset(providerId);
  if (preset) {
    settings.patchEditor({
      aiCompletion: {
        ...aiPrefs.value,
        provider: providerId,
        apiBase: preset.apiBase || aiPrefs.value.apiBase,
        model: preset.model || aiPrefs.value.model,
      },
    });
  }
  // 重新加载对应 provider 的 API Key
  aiKeyLoaded.value = false;
  aiKeyMasked.value = "";
  aiKeyInput.value = "";
  void loadAiKey();
}

/** 加载当前 provider 的 API Key */
async function loadAiKey() {
  const key = await getAiApiKey(aiPrefs.value.provider);
  if (key) {
    aiKeyMasked.value = "••••••••";
    aiKeyInput.value = "";
  } else {
    aiKeyMasked.value = "";
  }
  aiKeyLoaded.value = true;
}

/** 编辑 API Key 输入 */
function onAiKeyInput(value: string) {
  aiKeyInput.value = value;
  aiKeyMasked.value = "";
}

/** 保存 API Key */
async function saveAiKey() {
  const key = aiKeyInput.value.trim();
  if (!key) return;
  await setAiApiKey(aiPrefs.value.provider, key);
  aiKeyMasked.value = "••••••••";
  aiKeyInput.value = "";
  workspace.showNotice(t("settings.ai.keySaved"));
}

/** 更新 AI 配置字段 */
function patchAi(patch: Partial<typeof aiPrefs.value>) {
  settings.patchEditor({
    aiCompletion: { ...aiPrefs.value, ...patch },
  });
}

/** 测试连接 */
async function testConnection() {
  if (testingConnection.value) return;
  // 如果有新输入未保存，先保存
  if (aiKeyInput.value.trim()) {
    await saveAiKey();
  }
  const key = await getAiApiKey(aiPrefs.value.provider);
  if (!key) {
    workspace.showNotice(t("settings.ai.keyNotSet"));
    return;
  }
  testingConnection.value = true;
  try {
    const { aiCompleteStream } = await import("@/shared/aiApi");
    const { listen } = await import("@tauri-apps/api/event");
    const { getCompletionTemplate } = await import("@/features/ai/fimTemplates");
    const { getPreset } = await import("@/features/ai/providers");
    const testId = `test-${Date.now()}`;
    // 用当前 provider 的模板构造测试请求
    const preset = getPreset(aiPrefs.value.provider);
    const template = getCompletionTemplate(preset?.fimTemplate);
    const params = template.buildParams(
      "function hello() {\n  console.log(",
      ");\n}",
      32,
      0,
      aiPrefs.value.multiline,
    );
    // 先注册监听再发请求，避免首 token 过快丢失事件。
    // 首个增量 delta 到达即判定连接成功；10 秒无任何响应判定失败
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      let unlistenDelta: () => void = () => {};
      let unlistenErr: () => void = () => {};
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        unlistenDelta();
        unlistenErr();
        resolve(success);
      };
      const timer = setTimeout(() => finish(false), 10000);
      void (async () => {
        unlistenDelta = await listen<string>(`ai://delta/${testId}`, () => {
          clearTimeout(timer);
          finish(true);
        });
        unlistenErr = await listen<string>(`ai://error/${testId}`, (e) => {
          clearTimeout(timer);
          finish(false);
          workspace.showNotice(t("settings.ai.testFailed") + ": " + e.payload);
        });
        await aiCompleteStream({
          reqId: testId,
          apiBase: aiPrefs.value.apiBase,
          apiKey: key,
          model: aiPrefs.value.model,
          mode: params.mode,
          prompt: params.prompt ?? "",
          suffix: params.suffix ?? "",
          messages: params.messages,
          maxTokens: 32,
          temperature: 0,
          stop: params.stop,
        }).catch((e: unknown) => {
          clearTimeout(timer);
          finish(false);
          workspace.showNotice(t("settings.ai.testFailed") + ": " + String(e));
        });
      })();
    });
    if (ok) {
      workspace.showNotice(t("settings.ai.testSuccess"));
    }
  } catch (e) {
    workspace.showNotice(t("settings.ai.testFailed") + ": " + String(e));
  } finally {
    testingConnection.value = false;
  }
}

// 设置页打开时加载 API Key
void loadAiKey();

const themes: ThemeMeta[] = [
  { id: "miro-dark", name: t("settings.theme.miroDark"), available: true, preview: "dark" },
  { id: "midnight", name: t("settings.theme.midnight"), available: true, preview: "midnight" },
  { id: "cyberpunk", name: t("settings.theme.cyberpunk"), available: true, preview: "cyber" },
  { id: "dawn", name: t("settings.theme.dawn"), available: true, preview: "light" },
];

const navItems = computed(() => [
  { id: "editor" as const, label: t("settings.navEditor") },
  { id: "ai" as const, label: t("settings.navAi") },
  { id: "shortcuts" as const, label: t("settings.navShortcuts") },
  { id: "system" as const, label: t("settings.navAbout") },
]);

const completionHint = computed(() =>
  t("settings.completionHint", { shortcut: formatShortcut("mod", "Space") }),
);

const shortcutRows = computed(() => [
  { keys: formatShortcut("mod", "O"), action: t("settings.shortcutOpenFolder") },
  { keys: formatShortcut("mod", "P"), action: t("settings.shortcutQuickOpen") },
  {
    keys: formatShortcut("mod", "shift", "F"),
    action: t("settings.shortcutFindInFiles"),
  },
  { keys: formatShortcut("mod", "S"), action: t("settings.shortcutSave") },
  {
    keys: formatShortcut("shift", "alt", "F"),
    action: t("settings.shortcutFormat"),
  },
  { keys: formatShortcut("mod", ","), action: t("settings.shortcutSettings") },
  { keys: formatShortcut("mod", "Space"), action: t("settings.shortcutComplete") },
  { keys: formatShortcut("mod", "Enter"), action: t("settings.shortcutGoToDef") },
  { keys: formatShortcut("mod", "["), action: t("settings.shortcutGoBack") },
  { keys: formatShortcut("alt", "F1"), action: t("settings.shortcutReveal") },
  { keys: formatShortcut("mod", "J"), action: t("settings.shortcutTerminal") },
  { keys: formatShortcut("mod", "B"), action: t("settings.shortcutSidebar") },
]);

const activeThemeLabel = computed(() => THEME_LABELS[theme.value]);

const activeNavLabel = computed(
  () => navItems.value.find((n) => n.id === activeNav.value)?.label ?? "",
);

function selectTheme(id: ThemeId) {
  settings.setTheme(id);
}

function onOverlayClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    ui.closeSettings();
  }
}
</script>

<template>
  <div class="overlay" @mousedown="onOverlayClick">
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.title')"
    >
      <aside class="nav">
        <h2 class="nav-title">{{ t("settings.title") }}</h2>
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="nav-item"
          :class="{ active: activeNav === item.id }"
          @click="activeNav = item.id"
        >
          {{ item.label }}
        </button>
        <div class="nav-footer">
          <label class="field-label">{{ t("settings.language") }}</label>
          <select
            class="ui-select"
            :value="locale"
            @change="settings.setLocale(($event.target as HTMLSelectElement).value as 'zh-CN' | 'en-US')"
          >
            <option value="zh-CN">{{ t("settings.langZh") }}</option>
            <option value="en-US">{{ t("settings.langEn") }}</option>
          </select>
        </div>
      </aside>

      <section class="content">
        <header class="content-header">
          <div>
            <h1>{{ activeNavLabel }}</h1>
            <p v-if="activeNav === 'editor'">
              {{ t("settings.editorSubtitle", { theme: activeThemeLabel }) }}
            </p>
            <p v-else-if="activeNav === 'shortcuts'">
              {{ t("settings.shortcutsSubtitle") }}
            </p>
            <p v-else>{{ t("settings.aboutSubtitle") }}</p>
          </div>
          <button
            type="button"
            class="close"
            :title="t('common.close')"
            @click="ui.closeSettings()"
          >
            <X :size="18" />
          </button>
        </header>

        <div class="scroll">
          <template v-if="activeNav === 'editor'">
            <div class="ui-card section">
              <h3>{{ t("settings.appearance") }}</h3>
              <div class="theme-grid">
                <button
                  v-for="item in themes"
                  :key="item.id"
                  type="button"
                  class="theme-card"
                  :data-selected="theme === item.id"
                  @click="selectTheme(item.id)"
                >
                  <div class="preview" :data-kind="item.preview">
                    <div class="preview-bar" />
                    <div class="preview-lines">
                      <span /><span /><span />
                    </div>
                    <span v-if="theme === item.id" class="check">
                      <Check :size="12" />
                    </span>
                  </div>
                  <span class="theme-name">{{ item.name }}</span>
                </button>
              </div>
            </div>

            <div class="ui-card section">
              <h3>{{ t("settings.layout") }}</h3>
              <div class="form-grid">
                <label class="field">
                  <span class="field-label">{{ t("settings.fontSize") }}</span>
                  <input
                    v-bind="PLAIN_INPUT_ATTRS"
                    class="ui-input"
                    type="number"
                    name="miro-font-size"
                    min="10"
                    max="24"
                    :value="editor.fontSize"
                    @change="settings.patchEditor({ fontSize: Number(($event.target as HTMLInputElement).value) || 13 })"
                  />
                </label>
                <label class="field">
                  <span class="field-label">{{ t("settings.tabSize") }}</span>
                  <select
                    class="ui-select"
                    :value="editor.tabSize"
                    @change="settings.patchEditor({ tabSize: Number(($event.target as HTMLSelectElement).value) as 2 | 4 })"
                  >
                    <option :value="2">2 Spaces</option>
                    <option :value="4">4 Spaces</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">{{ t("settings.wordWrap") }}</span>
                  <select
                    class="ui-select"
                    :value="editor.wordWrap ? 'on' : 'off'"
                    @change="settings.patchEditor({ wordWrap: ($event.target as HTMLSelectElement).value === 'on' })"
                  >
                    <option value="on">{{ t("common.on") }}</option>
                    <option value="off">{{ t("common.off") }}</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">{{ t("settings.lineNumbers") }}</span>
                  <select
                    class="ui-select"
                    :value="editor.lineNumbers ? 'on' : 'off'"
                    @change="settings.patchEditor({ lineNumbers: ($event.target as HTMLSelectElement).value === 'on' })"
                  >
                    <option value="on">{{ t("common.on") }}</option>
                    <option value="off">{{ t("common.off") }}</option>
                  </select>
                </label>
              </div>
            </div>

            <div class="ui-card section">
              <h3>{{ t("settings.fileSave") }}</h3>
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("settings.autoSave") }}</span>
                  <p class="desc">
                    {{ t("settings.autoSaveDesc") }}
                  </p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  role="switch"
                  :aria-checked="editor.autoSave"
                  :data-on="editor.autoSave"
                  :title="editor.autoSave ? t('settings.enabled') : t('settings.disabled')"
                  @click="settings.patchEditor({ autoSave: !editor.autoSave })"
                />
              </div>
              <label v-if="editor.autoSave" class="field delay-field">
                <span class="field-label">{{ t("settings.delay") }}</span>
                <select
                  class="ui-select"
                  :value="editor.autoSaveDelayMs"
                  @change="settings.patchEditor({ autoSaveDelayMs: Number(($event.target as HTMLSelectElement).value) || 1000 })"
                >
                  <option :value="500">{{ t("settings.delay05") }}</option>
                  <option :value="1000">{{ t("settings.delay1") }}</option>
                  <option :value="2000">{{ t("settings.delay2") }}</option>
                  <option :value="5000">{{ t("settings.delay5") }}</option>
                </select>
              </label>
            </div>

            <div class="ui-card section">
              <h3>{{ t("settings.tooling") }}</h3>
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("settings.prettierEnabled") }}</span>
                  <p class="desc">{{ t("settings.prettierDesc") }}</p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  role="switch"
                  :aria-checked="editor.prettierEnabled"
                  :data-on="editor.prettierEnabled"
                  :title="editor.prettierEnabled ? t('settings.enabled') : t('settings.disabled')"
                  @click="settings.patchEditor({ prettierEnabled: !editor.prettierEnabled })"
                />
              </div>
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("settings.formatOnSave") }}</span>
                  <p class="desc">
                    {{ t("settings.formatOnSaveDesc", { shortcut: formatShortcut("shift", "alt", "F") }) }}
                  </p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  role="switch"
                  :aria-checked="editor.formatOnSave"
                  :data-on="editor.formatOnSave"
                  :title="editor.formatOnSave ? t('settings.enabled') : t('settings.disabled')"
                  @click="settings.patchEditor({ formatOnSave: !editor.formatOnSave })"
                />
              </div>
              <label class="field delay-field">
                <span class="field-label">{{ t("settings.updateImportsOnMove") }}</span>
                <p class="desc">{{ t("settings.updateImportsOnMoveDesc") }}</p>
                <select
                  class="ui-select"
                  :value="editor.updateImportsOnMove"
                  @change="settings.patchEditor({ updateImportsOnMove: ($event.target as HTMLSelectElement).value as 'always' | 'prompt' | 'never' })"
                >
                  <option value="prompt">{{ t("settings.updateImportsOnMovePrompt") }}</option>
                  <option value="always">{{ t("settings.updateImportsOnMoveAlways") }}</option>
                  <option value="never">{{ t("settings.updateImportsOnMoveNever") }}</option>
                </select>
              </label>
            </div>

            <div class="ui-card section">
              <h3>{{ t("lsp.title") }}</h3>
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("lsp.enabled") }}</span>
                  <p class="desc">{{ t("lsp.enabledDesc") }}</p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  role="switch"
                  :aria-checked="editor.lspEnabled"
                  :data-on="editor.lspEnabled"
                  :title="editor.lspEnabled ? t('settings.enabled') : t('settings.disabled')"
                  @click="toggleLsp(!editor.lspEnabled)"
                />
              </div>
              <p class="desc">{{ lspRuntimeStatus }}</p>

              <!-- 语言服务列表：按语言独立安装 / 更新 / 卸载 -->
              <div class="ls-bundle">
                <p class="desc">
                  {{ t("lsp.bundleDesc") }}
                </p>

                <!-- 语言服务列表 -->
                <div class="ls-list">
                  <div
                    v-for="item in lsItems"
                    :key="item.key"
                    class="ls-item"
                  >
                    <div class="ls-item-icon">{{ item.key === "ts" ? "TS" : "Vue" }}</div>
                    <div class="ls-item-body">
                      <div class="ls-item-head">
                        <span class="ls-item-name">{{ item.name }}</span>
                        <span
                          class="ls-badge"
                          :class="`badge-${item.badge}`"
                        >
                          <template v-if="item.badge === 'installed'">
                            {{ t("lsp.lsBadgeInstalled") }} v{{ item.installed }}
                          </template>
                          <template v-else-if="item.badge === 'update'">
                            {{ t("lsp.lsBadgeUpdate") }} v{{ item.latest }}
                          </template>
                          <template v-else>{{ t("lsp.lsBadgeNotInstalled") }}</template>
                        </span>
                      </div>
                      <p class="desc">{{ item.desc }}</p>

                      <!-- 该语言安装进行中：进度条 -->
                      <div v-if="item.busy" class="ls-progress">
                        <div class="ls-progress-bar">
                          <div class="ls-progress-fill" :style="{ width: `${item.percent}%` }" />
                        </div>
                        <p class="desc">
                          {{ lsPhaseTextFor(item.key) }} {{ item.percent > 0 && item.phase === 'download' ? item.percent + '%' : '' }}
                        </p>
                      </div>
                    </div>

                    <!-- 操作按钮（安装中不显示） -->
                    <template v-if="!item.busy">
                      <button
                        v-if="item.badge === 'not-installed'"
                        type="button"
                        class="ui-btn primary"
                        :disabled="!lsStates[item.key]?.status?.supported || !lsStates[item.key]?.status?.latestAvailable"
                        @click="installLanguageService(item.key)"
                      >
                        {{ t("lsp.install") }}
                      </button>
                      <button
                        v-else-if="item.badge === 'update'"
                        type="button"
                        class="ui-btn ghost"
                        @click="installLanguageService(item.key)"
                      >
                        {{ t("lsp.update") }}
                      </button>
                      <template v-else>
                        <button
                          type="button"
                          class="ui-btn ghost danger"
                          @click="uninstallLanguageService(item.key)"
                        >
                          {{ t("lsp.uninstall") }}
                        </button>
                      </template>
                    </template>
                  </div>
                </div>

                <!-- 镜像源选择 + 连通状态 -->
                <label class="field ls-mirror-field">
                  <span class="field-label">{{ t("lsp.mirror") }}</span>
                  <p class="desc">{{ t("lsp.mirrorDesc") }}</p>
                  <div class="ls-mirror-row">
                    <select class="ui-select" v-model="lsMirror" @change="onMirrorChange">
                      <option
                        v-for="opt in lsMirrorOptions"
                        :key="opt.id"
                        :value="opt.id"
                      >
                        {{ opt.label }}
                      </option>
                    </select>
                    <span class="ls-mirror-status" :class="lsMirrorStatus.cls">
                      <span class="ms-dot" />
                      {{ lsMirrorStatus.text }}
                    </span>
                  </div>
                </label>

                <!-- 自定义镜像地址 -->
                <label v-if="lsMirror === 'custom'" class="field delay-field">
                  <span class="field-label">{{ t("lsp.customBase") }}</span>
                  <input
                    v-model="lsCustomBase"
                    type="text"
                    class="ui-input"
                    :placeholder="t('lsp.customBasePlaceholder')"
                    @change="onMirrorChange"
                  />
                </label>

                <!-- 安装错误提示（显示首个有错误的语言） -->
                <p v-if="lsStates.ts?.error" class="desc error-text">{{ lsStates.ts.error }}</p>
                <p v-else-if="lsStates.vue?.error" class="desc error-text">{{ lsStates.vue.error }}</p>
              </div>
            </div>

            <div class="ui-card section">
              <h3>{{ t("settings.completion") }}</h3>
              <p class="desc">
                {{ completionHint }}
              </p>
            </div>
          </template>

          <template v-else-if="activeNav === 'ai'">
            <div class="ui-card section">
              <h3>{{ t("settings.ai.title") }}</h3>
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("settings.ai.enabled") }}</span>
                  <p class="desc">{{ t("settings.ai.enabledDesc") }}</p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  role="switch"
                  :aria-checked="aiPrefs.enabled"
                  :data-on="aiPrefs.enabled"
                  :title="aiPrefs.enabled ? t('settings.enabled') : t('settings.disabled')"
                  @click="patchAi({ enabled: !aiPrefs.enabled })"
                />
              </div>
            </div>

            <div class="ui-card section ai-config">
              <label class="field">
                <span class="field-label">{{ t("settings.ai.provider") }}</span>
                <select
                  class="ui-select"
                  :value="aiPrefs.provider"
                  @change="onProviderChange(($event.target as HTMLSelectElement).value as AiProviderId)"
                >
                  <option v-for="opt in providerOptions" :key="opt.id" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </select>
              </label>

              <label class="field">
                <span class="field-label">{{ t("settings.ai.apiKey") }}</span>
                <div class="ai-key-row">
                  <input
                    class="ui-input"
                    :type="aiKeyDisplay ? 'password' : 'text'"
                    :placeholder="aiKeyMasked || t('settings.ai.apiKeyPlaceholder')"
                    :value="aiKeyInput"
                    v-bind="PLAIN_INPUT_ATTRS"
                    @input="onAiKeyInput(($event.target as HTMLInputElement).value)"
                  />
                  <button
                    v-if="aiKeyInput"
                    type="button"
                    class="check-update-btn"
                    @click="saveAiKey"
                  >
                    {{ t("settings.ai.saveKey") }}
                  </button>
                </div>
              </label>

              <label class="field">
                <span class="field-label">{{ t("settings.ai.apiBase") }}</span>
                <input
                  class="ui-input"
                  type="text"
                  :value="aiPrefs.apiBase"
                  v-bind="PLAIN_INPUT_ATTRS"
                  @input="patchAi({ apiBase: ($event.target as HTMLInputElement).value })"
                />
              </label>

              <label class="field">
                <span class="field-label">{{ t("settings.ai.model") }}</span>
                <input
                  class="ui-input"
                  type="text"
                  :value="aiPrefs.model"
                  v-bind="PLAIN_INPUT_ATTRS"
                  @input="patchAi({ model: ($event.target as HTMLInputElement).value })"
                />
              </label>

              <label class="field">
                <span class="field-label">{{ t("settings.ai.multiline") }}</span>
                <select
                  class="ui-select"
                  :value="aiPrefs.multiline"
                  @change="patchAi({ multiline: ($event.target as HTMLSelectElement).value as 'auto' | 'always' | 'never' })"
                >
                  <option value="auto">{{ t("settings.ai.multilineAuto") }}</option>
                  <option value="always">{{ t("settings.ai.multilineAlways") }}</option>
                  <option value="never">{{ t("settings.ai.multilineNever") }}</option>
                </select>
              </label>

              <div class="ai-params-grid">
                <label class="field">
                  <span class="field-label">{{ t("settings.ai.debounceMs") }}</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="100"
                    max="3000"
                    step="50"
                    :value="aiPrefs.debounceMs"
                    v-bind="PLAIN_INPUT_ATTRS"
                    @input="patchAi({ debounceMs: Number(($event.target as HTMLInputElement).value) || 350 })"
                  />
                </label>
                <label class="field">
                  <span class="field-label">{{ t("settings.ai.showWhateverMs") }}</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="0"
                    max="2000"
                    step="50"
                    :value="aiPrefs.showWhateverMs"
                    v-bind="PLAIN_INPUT_ATTRS"
                    @input="patchAi({ showWhateverMs: Number(($event.target as HTMLInputElement).value) || 300 })"
                  />
                </label>
                <label class="field">
                  <span class="field-label">{{ t("settings.ai.maxTokens") }}</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="16"
                    max="4096"
                    step="16"
                    :value="aiPrefs.maxTokens"
                    v-bind="PLAIN_INPUT_ATTRS"
                    @input="patchAi({ maxTokens: Number(($event.target as HTMLInputElement).value) || 256 })"
                  />
                </label>
                <label class="field">
                  <span class="field-label">{{ t("settings.ai.temperature") }}</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    :value="aiPrefs.temperature"
                    v-bind="PLAIN_INPUT_ATTRS"
                    @input="patchAi({ temperature: Number(($event.target as HTMLInputElement).value) || 0.2 })"
                  />
                </label>
                <label class="field">
                  <span class="field-label">{{ t("settings.ai.maxPromptTokens") }}</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="256"
                    max="8192"
                    step="128"
                    :value="aiPrefs.maxPromptTokens"
                    v-bind="PLAIN_INPUT_ATTRS"
                    @input="patchAi({ maxPromptTokens: Number(($event.target as HTMLInputElement).value) || 1024 })"
                  />
                </label>
              </div>

              <button
                type="button"
                class="check-update-btn"
                :disabled="testingConnection"
                @click="testConnection"
              >
                {{ testingConnection ? t("settings.ai.testing") : t("settings.ai.testConnection") }}
              </button>
            </div>
          </template>

          <template v-else-if="activeNav === 'shortcuts'">
            <div class="ui-card section">
              <h3>{{ t("settings.shortcutsTitle") }}</h3>
              <dl class="shortcut-list">
                <div v-for="row in shortcutRows" :key="row.keys">
                  <dt>{{ row.keys }}</dt>
                  <dd>{{ row.action }}</dd>
                </div>
              </dl>
            </div>
          </template>

          <template v-else>
            <div class="ui-card section">
              <h3>{{ t("settings.aboutTitle") }}</h3>
              <p class="desc">{{ t("settings.aboutDesc") }}</p>
              <p class="desc">
                {{ t("settings.aboutVersion", { version: appVersion }) }}
              </p>
              <p class="desc muted">{{ t("settings.aboutFocus") }}</p>
            </div>
            <div class="ui-card section">
              <h3>{{ t("settings.updates") }}</h3>
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("settings.autoCheckUpdates") }}</span>
                  <p class="desc">
                    {{ t("settings.autoCheckUpdatesDesc") }}
                  </p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  role="switch"
                  :aria-checked="settings.settings.autoCheckUpdates"
                  :data-on="settings.settings.autoCheckUpdates"
                  @click="settings.setAutoCheckUpdates(!settings.settings.autoCheckUpdates)"
                />
              </div>
              <div class="update-actions">
                <button
                  type="button"
                  class="check-update-btn"
                  :disabled="checkingUpdate"
                  @click="onCheckUpdate"
                >
                  {{
                    checkingUpdate
                      ? t("settings.checkingUpdate")
                      : t("settings.checkUpdate")
                  }}
                </button>
              </div>
            </div>
            <div class="ui-card section">
              <h3>{{ t("settings.license") }}</h3>
              <p class="desc">{{ t("settings.licenseMit") }}</p>
              <p class="desc muted">
                {{ t("settings.licenseThirdParty") }}
              </p>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: var(--bg-overlay);
  backdrop-filter: blur(6px);
  animation: miro-overlay-in var(--transition-normal) var(--ease-out);
  padding: 32px;
}

.modal {
  width: min(920px, 100%);
  animation: miro-dialog-in var(--transition-normal) var(--ease-out);
  height: min(640px, 100%);
  display: grid;
  grid-template-columns: 220px 1fr;
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px 14px;
  background: var(--bg-app);
  border-right: 1px solid var(--border-subtle);
}

.nav-title {
  margin: 0 8px 12px;
  font-size: 20px;
  font-weight: 700;
}

.nav-item {
  text-align: left;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.nav-item:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.nav-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}

.content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* grid/flex 子项默认 min-height:auto，不设 0 则 overflow 无法收缩滚动 */
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 22px 24px 8px;
}

.content-header h1 {
  margin: 0;
  font-size: 22px;
}

.content-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
}

.close {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.close:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section {
  padding: 16px 18px 18px;
}

.section h3 {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 600;
}

.section.placeholder h3 {
  margin-bottom: 8px;
}

.desc {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.muted {
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.mt {
  margin-top: 14px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.theme-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}

.preview {
  position: relative;
  height: 72px;
  border-radius: var(--radius-md);
  border: 2px solid transparent;
  overflow: hidden;
  padding: 8px;
}

.theme-card[data-selected="true"] .preview {
  border-color: var(--accent);
}

.preview[data-kind="dark"] {
  background: #121218;
}

.preview[data-kind="midnight"] {
  background: #0b1220;
}

.preview[data-kind="cyber"] {
  background: linear-gradient(135deg, #1a0b1f, #062a2a);
}

.preview[data-kind="light"] {
  background: #ffffff;
  border-color: #e6e8ec;
}

.theme-card[data-selected="true"] .preview[data-kind="light"] {
  border-color: var(--accent);
}

.preview-bar {
  height: 6px;
  width: 42%;
  border-radius: 999px;
  margin-bottom: 8px;
  background: var(--accent);
  opacity: 0.85;
}

.preview[data-kind="light"] .preview-bar {
  background: #2563eb;
}

.preview-lines {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.preview-lines span {
  display: block;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.preview-lines span:nth-child(2) {
  width: 70%;
}

.preview-lines span:nth-child(3) {
  width: 55%;
}

.preview[data-kind="light"] .preview-lines span {
  background: rgba(24, 24, 27, 0.12);
}

.check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: var(--accent-fg);
}

.theme-name {
  font-size: 12px;
  color: var(--text-secondary);
}

.theme-card[data-selected="true"] .theme-name {
  color: var(--text-primary);
  font-weight: 600;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.full {
  grid-column: 1 / -1;
}

.field-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.save-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  &:not(:first-child) {
    margin-top: 8px;
  }
}

.save-copy {
  flex: 1;
  min-width: 0;
}

.save-copy .field-label {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.save-copy .desc {
  margin-top: 6px;
}

.delay-field {
  margin-top: 14px;
  max-width: 200px;
}

/* 镜像行：不套 delay-field 的 200px 限制，select + 状态文字占满整行，
   文字在 select 内显示不下时才截断，不再「文字跟着下拉框长度走」 */
.ls-mirror-field {
  margin-top: 14px;
}

.update-actions {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.check-update-btn {
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 13px;
}

.check-update-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.check-update-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.row-between h3 {
  margin: 0;
}

.commit-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  resize: vertical;
  font-family: var(--font-ui);
}

.shortcut-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shortcut-list div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
}

.shortcut-list dt {
  font-family: var(--font-mono);
  color: var(--accent);
}

.shortcut-list dd {
  margin: 0;
  color: var(--text-secondary);
}

/* ==================== AI 补全配置面板 ==================== */

/* 字段垂直间距：与 editor 面板 .form-grid 的 gap 节奏一致 */
.ai-config > .field + .field,
.ai-config > .field + .ai-params-grid,
.ai-config > .ai-params-grid + .check-update-btn {
  margin-top: 16px;
}

.ai-key-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ai-key-row .ui-input {
  flex: 1;
}

.ai-params-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* 奇数个字段时（当前 5 个），最后一个跨全宽避免孤立 */
.ai-params-grid > .field:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

/* ==================== 语言服务捆绑包 ==================== */

.ls-bundle {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.ls-progress {
  margin-top: 12px;
}

.ls-progress-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}

.ls-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.2s ease;
}

/* ==================== 语言服务列表 ==================== */

.ls-list {
  margin-top: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.ls-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.ls-item:last-child {
  border-bottom: none;
}

.ls-item-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  letter-spacing: 0.5px;
}

.ls-item-body {
  flex: 1;
  min-width: 0;
}

.ls-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.ls-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.ls-badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.badge-installed {
  background: var(--success-soft, rgba(34, 197, 94, 0.12));
  color: var(--success, #22c55e);
}

.badge-not-installed {
  background: var(--bg-app);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
}

.badge-update {
  background: var(--warning-soft, rgba(245, 158, 11, 0.12));
  color: var(--warning, #f59e0b);
}

.ls-uninstall-row {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

/* ==================== 镜像连通状态 ==================== */

.ls-mirror-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ls-mirror-row .ui-select {
  flex: 1;
  min-width: 0;
  width: 100%; /* 原生 select 固有宽度 = 最长 option，显式 100% 让它占满整行 */
}

.ls-mirror-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  white-space: nowrap;
}

.ms-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ms-ok .ms-dot {
  background: var(--success, #22c55e);
}

.ms-fail .ms-dot {
  background: var(--warning, #f59e0b);
}

.ms-checking .ms-dot {
  background: var(--text-muted);
  animation: ms-pulse 1s ease-in-out infinite;
}

.ms-ok {
  color: var(--success, #22c55e);
}

.ms-fail {
  color: var(--warning, #f59e0b);
}

.ms-checking {
  color: var(--text-muted);
}

@keyframes ms-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.error-text {
  color: var(--danger, #e5534b);
}

.ui-btn {
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 13px;
  white-space: nowrap;
}

.ui-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.ui-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.ui-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-app);
}

.ui-btn.primary:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg-app);
  opacity: 0.9;
}

.ui-btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger, #e5534b) 12%, transparent);
  border-color: var(--danger, #e5534b);
  color: var(--danger, #e5534b);
}
</style>
