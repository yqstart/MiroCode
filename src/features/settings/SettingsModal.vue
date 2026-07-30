<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Check, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { THEME_LABELS } from "@/features/editor/theme";
import { checkForAppUpdate, getAppVersion } from "@/shared/appUpdate";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { formatShortcut } from "@/shared/platform";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import type { ThemeId, ThemeMeta } from "@/shared/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const settings = useSettingsStore();
const ui = useUiStore();
const workspace = useWorkspaceStore();
const { theme, editor, locale } = storeToRefs(settings);

type NavId = "editor" | "shortcuts" | "system";

const activeNav = ref<NavId>("editor");
const appVersion = ref("…");
const checkingUpdate = ref(false);

onMounted(async () => {
  appVersion.value = await getAppVersion();
});

async function onCheckUpdate() {
  if (checkingUpdate.value) return;
  checkingUpdate.value = true;
  try {
    await checkForAppUpdate("manual", (message, ms) =>
      workspace.showNotice(message, ms),
    );
  } finally {
    checkingUpdate.value = false;
  }
}

const themes: ThemeMeta[] = [
  { id: "miro-dark", name: "Miro Dark", available: true, preview: "dark" },
  { id: "midnight", name: "Miro Midnight", available: true, preview: "midnight" },
  { id: "cyberpunk", name: "Miro Cyberpunk", available: true, preview: "cyber" },
  { id: "dawn", name: "Miro Dawn", available: true, preview: "light" },
];

const navItems = computed(() => [
  { id: "editor" as const, label: t("settings.navEditor") },
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
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("settings.formatOnSave") }}</span>
                  <p class="desc">
                    {{ t("settings.formatOnSaveDesc") }}
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
            </div>

            <div class="ui-card section">
              <h3>{{ t("settings.tooling") }}</h3>
              <div class="save-row">
                <div class="save-copy">
                  <span class="field-label">{{ t("settings.eslintEnabled") }}</span>
                  <p class="desc">{{ t("settings.eslintDesc") }}</p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  role="switch"
                  :aria-checked="editor.eslintEnabled"
                  :data-on="editor.eslintEnabled"
                  :title="editor.eslintEnabled ? t('settings.enabled') : t('settings.disabled')"
                  @click="settings.patchEditor({ eslintEnabled: !editor.eslintEnabled })"
                />
              </div>
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
            </div>

            <div class="ui-card section">
              <h3>{{ t("settings.completion") }}</h3>
              <p class="desc">
                {{ completionHint }}
              </p>
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
  padding: 32px;
}

.modal {
  width: min(920px, 100%);
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

.update-actions {
  margin-top: 14px;
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
</style>
