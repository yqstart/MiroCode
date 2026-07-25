<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { THEME_LABELS } from "@/features/editor/theme";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { ThemeId, ThemeMeta } from "@/shared/types";

const settings = useSettingsStore();
const ui = useUiStore();
const { theme, editor, locale, ai } = storeToRefs(settings);

type NavId =
  | "editor"
  | "provider"
  | "agent"
  | "mcp"
  | "shortcuts"
  | "system";

const activeNav = ref<NavId>("editor");

const themes: ThemeMeta[] = [
  { id: "adnify-dark", name: "Miro Dark", available: true, preview: "dark" },
  { id: "midnight", name: "Miro Midnight", available: true, preview: "midnight" },
  { id: "cyberpunk", name: "Miro Cyberpunk", available: true, preview: "cyber" },
  { id: "dawn", name: "Miro Dawn", available: true, preview: "light" },
];

const navItems: { id: NavId; label: string }[] = [
  { id: "editor", label: "编辑器" },
  { id: "provider", label: "模型供应商" },
  { id: "agent", label: "智能体" },
  { id: "mcp", label: "MCP" },
  { id: "shortcuts", label: "快捷键" },
  { id: "system", label: "系统" },
];

const activeThemeLabel = computed(() => THEME_LABELS[theme.value]);

const activeProvider = computed(
  () =>
    ai.value.providers.find((p) => p.id === ai.value.activeProviderId) ??
    ai.value.providers[0],
);

function selectTheme(id: ThemeId) {
  settings.setTheme(id);
}

function toggleCompletion() {
  settings.patchAiCompletion({ enabled: !ai.value.completion.enabled });
}

function onOverlayClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    ui.closeSettings();
  }
}
</script>

<template>
  <div class="overlay" @mousedown="onOverlayClick">
    <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
      <aside class="nav">
        <h2 class="nav-title">设置</h2>
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
          <label class="field-label">界面语言</label>
          <select
            class="ui-select"
            :value="locale"
            @change="settings.setLocale(($event.target as HTMLSelectElement).value as 'zh-CN' | 'en-US')"
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </aside>

      <section class="content">
        <header class="content-header">
          <div>
            <h1>{{ navItems.find((n) => n.id === activeNav)?.label }}</h1>
            <p v-if="activeNav === 'editor'">
              外观、排版与编辑偏好 · 当前 {{ activeThemeLabel }}
            </p>
            <p v-else-if="activeNav === 'provider'">配置模型供应商（本地占位）</p>
            <p v-else-if="activeNav === 'agent'">智能体占位面板</p>
            <p v-else-if="activeNav === 'mcp'">MCP 服务器配置</p>
            <p v-else-if="activeNav === 'shortcuts'">常用快捷键一览</p>
            <p v-else>系统与关于</p>
          </div>
          <button type="button" class="close" title="关闭" @click="ui.closeSettings()">
            <X :size="18" />
          </button>
        </header>

        <div class="scroll">
          <template v-if="activeNav === 'editor'">
            <div class="ui-card section">
              <h3>外观主题</h3>
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
              <h3>排版与布局</h3>
              <div class="form-grid">
                <label class="field">
                  <span class="field-label">字号</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="10"
                    max="24"
                    :value="editor.fontSize"
                    @change="settings.patchEditor({ fontSize: Number(($event.target as HTMLInputElement).value) || 13 })"
                  />
                </label>
                <label class="field">
                  <span class="field-label">TAB 大小</span>
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
                  <span class="field-label">自动换行</span>
                  <select
                    class="ui-select"
                    :value="editor.wordWrap ? 'on' : 'off'"
                    @change="settings.patchEditor({ wordWrap: ($event.target as HTMLSelectElement).value === 'on' })"
                  >
                    <option value="on">开启</option>
                    <option value="off">关闭</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">行号</span>
                  <select
                    class="ui-select"
                    :value="editor.lineNumbers ? 'on' : 'off'"
                    @change="settings.patchEditor({ lineNumbers: ($event.target as HTMLSelectElement).value === 'on' })"
                  >
                    <option value="on">开启</option>
                    <option value="off">关闭</option>
                  </select>
                </label>
              </div>
            </div>

            <div class="ui-card section">
              <div class="row-between">
                <div>
                  <h3>AI 代码补全</h3>
                  <p class="desc">本地占位模式，未连接真实模型</p>
                </div>
                <button
                  type="button"
                  class="ui-toggle"
                  :data-on="ai.completion.enabled ? 'true' : 'false'"
                  aria-label="AI 补全开关"
                  @click="toggleCompletion"
                />
              </div>
              <div class="form-grid mt">
                <label class="field">
                  <span class="field-label">触发延迟 (ms)</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="100"
                    max="2000"
                    :value="ai.completion.delayMs"
                    @change="settings.patchAiCompletion({ delayMs: Number(($event.target as HTMLInputElement).value) || 300 })"
                  />
                </label>
                <label class="field">
                  <span class="field-label">最大 Token</span>
                  <input
                    class="ui-input"
                    type="number"
                    min="16"
                    max="4096"
                    :value="ai.completion.maxTokens"
                    @change="settings.patchAiCompletion({ maxTokens: Number(($event.target as HTMLInputElement).value) || 128 })"
                  />
                </label>
                <label class="field full">
                  <span class="field-label">触发字符</span>
                  <input
                    class="ui-input"
                    type="text"
                    :value="ai.completion.triggerChars"
                    @change="settings.patchAiCompletion({ triggerChars: ($event.target as HTMLInputElement).value })"
                  />
                </label>
              </div>
            </div>
          </template>

          <template v-else-if="activeNav === 'provider'">
            <div class="ui-card section">
              <h3>当前供应商</h3>
              <p class="desc">「{{ activeProvider?.name }}」— 本地占位，不会发起真实 API 请求</p>
              <div class="form-grid mt">
                <label class="field full">
                  <span class="field-label">Base URL</span>
                  <input
                    class="ui-input"
                    type="text"
                    placeholder="https://api.example.com"
                    :value="activeProvider?.baseUrl"
                    disabled
                  />
                </label>
                <label class="field">
                  <span class="field-label">模型</span>
                  <input
                    class="ui-input"
                    type="text"
                    :value="activeProvider?.model"
                    disabled
                  />
                </label>
              </div>
            </div>
          </template>

          <template v-else-if="activeNav === 'agent'">
            <div class="ui-card section placeholder">
              <h3>智能体</h3>
              <p class="desc">
                Miro Code 智能体功能正在规划中。此处为占位面板，后续将支持对话式编程助手、任务编排与工具调用。
              </p>
              <label class="field full mt">
                <span class="field-label">系统提示词（占位）</span>
                <textarea
                  class="commit-input"
                  rows="4"
                  :value="ai.agent.systemPrompt"
                  disabled
                />
              </label>
            </div>
          </template>

          <template v-else-if="activeNav === 'mcp'">
            <div class="ui-card section placeholder">
              <h3>MCP 服务器</h3>
              <p class="desc">
                模型上下文协议（MCP）配置占位。可在后续版本添加本地/远程 MCP 服务器。
              </p>
              <p v-if="!ai.mcpServers.length" class="muted">尚未配置 MCP 服务器</p>
            </div>
          </template>

          <template v-else-if="activeNav === 'shortcuts'">
            <div class="ui-card section">
              <h3>常用快捷键</h3>
              <dl class="shortcut-list">
                <div><dt>⌘/Ctrl + O</dt><dd>打开文件夹</dd></div>
                <div><dt>⌘/Ctrl + P</dt><dd>快速打开文件</dd></div>
                <div><dt>⌘/Ctrl + Shift + F</dt><dd>打开搜索面板</dd></div>
                <div><dt>⌘/Ctrl + S</dt><dd>保存当前文件</dd></div>
                <div><dt>⌘/Ctrl + ,</dt><dd>打开设置</dd></div>
                <div><dt>⌘/Ctrl + Enter</dt><dd>跳转到 import/路径</dd></div>
                <div><dt>⌘/Ctrl + [</dt><dd>返回上一跳转位置</dd></div>
              </dl>
            </div>
          </template>

          <template v-else>
            <div class="ui-card section">
              <h3>关于 Miro Code</h3>
              <p class="desc">米罗编辑器 · 轻量化桌面代码编辑器</p>
              <p class="desc">版本 0.1.0 · Tauri + Vue 3 + CodeMirror 6</p>
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
  background: #f8fafc;
  border-color: #e4e4e7;
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
  background: #3b82f6;
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
