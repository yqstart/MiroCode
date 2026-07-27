<script setup lang="ts">
import { computed, ref } from "vue";
import { Columns2, Eye, FileCode, TerminalSquare, X } from "lucide-vue-next";
import { marked } from "marked";
import { storeToRefs } from "pinia";
import CodeMirrorEditor from "@/features/editor/CodeMirrorEditor.vue";
import CompareView from "@/features/git/CompareView.vue";
import SessionsView from "@/features/sessions/SessionsView.vue";
import { useCompareStore } from "@/stores/compare";
import { useEditorStore } from "@/stores/editor";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

const editor = useEditorStore();
const sessions = useSessionsStore();
const compare = useCompareStore();
const workspace = useWorkspaceStore();
const { tabs, activePath, activeTab } = storeToRefs(editor);
const { open: sessionsOpen, isFocused: sessionsFocused, tabId: sessionsTabId } =
  storeToRefs(sessions);
const {
  tabs: compareTabs,
  activeId: compareActiveId,
  isFocused: compareFocused,
} = storeToRefs(compare);

const markdownPreview = ref(false);

const isMarkdown = computed(() => {
  const name = activeTab.value?.name.toLowerCase() ?? "";
  return name.endsWith(".md") || name.endsWith(".markdown");
});

const previewHtml = computed(() => {
  if (
    !activeTab.value ||
    !markdownPreview.value ||
    sessionsFocused.value ||
    compareFocused.value
  ) {
    return "";
  }
  return marked.parse(activeTab.value.content, { async: false }) as string;
});

const hasAnyTab = computed(
  () =>
    tabs.value.length > 0 ||
    sessionsOpen.value ||
    compareTabs.value.length > 0,
);

const showFileEditor = computed(
  () => !sessionsFocused.value && !compareFocused.value && Boolean(activeTab.value),
);

function togglePreview() {
  if (!isMarkdown.value || sessionsFocused.value || compareFocused.value) return;
  markdownPreview.value = !markdownPreview.value;
}

function activateFile(path: string) {
  sessions.blurSessions();
  compare.blurCompare();
  editor.activate(path);
}

function activateSessions() {
  compare.blurCompare();
  sessions.focusSessions();
}

function activateCompare(id: string) {
  sessions.blurSessions();
  compare.activate(id);
}

function closeSessionsTab() {
  sessions.closeSessions();
  if (compareTabs.value.length && !editor.activePath) {
    compare.focusCompare();
    return;
  }
  if (!editor.activePath && editor.tabs.length) {
    editor.activate(editor.tabs[0].path);
  }
}

function closeCompareTab(id: string) {
  compare.closeTab(id);
  if (!compare.tabs.length && !sessionsFocused.value && editor.activePath) {
    compare.blurCompare();
  }
}
</script>

<template>
  <section class="editor-area">
    <div v-if="hasAnyTab" class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.path"
        type="button"
        class="tab"
        :class="{ active: showFileEditor && tab.path === activePath }"
        @click="activateFile(tab.path)"
        @auxclick.middle.prevent="editor.closeTab(tab.path)"
      >
        <span class="dot" :class="{ dirty: editor.isDirty(tab.path) }" />
        <span class="name">{{ tab.name }}</span>
        <span
          class="close"
          title="关闭"
          @click.stop="editor.closeTab(tab.path)"
        >
          <X :size="12" />
        </span>
      </button>

      <button
        v-for="tab in compareTabs"
        :key="tab.id"
        type="button"
        class="tab compare-tab"
        :class="{ active: compareFocused && tab.id === compareActiveId }"
        @click="activateCompare(tab.id)"
        @auxclick.middle.prevent="closeCompareTab(tab.id)"
      >
        <Columns2 :size="12" class="cmp-icon" />
        <span class="name">{{ tab.title }}</span>
        <span class="close" title="关闭" @click.stop="closeCompareTab(tab.id)">
          <X :size="12" />
        </span>
      </button>

      <button
        v-if="sessionsOpen"
        type="button"
        class="tab session-tab"
        :class="{ active: sessionsFocused }"
        :data-id="sessionsTabId"
        @click="activateSessions"
        @auxclick.middle.prevent="closeSessionsTab"
      >
        <TerminalSquare :size="12" class="term-icon" />
        <span class="name">终端</span>
        <span class="close" title="关闭" @click.stop="closeSessionsTab">
          <X :size="12" />
        </span>
      </button>

      <button
        v-if="isMarkdown && activeTab && showFileEditor"
        type="button"
        class="preview-toggle"
        :title="markdownPreview ? '编辑模式' : '预览模式'"
        @click="togglePreview"
      >
        <Eye v-if="!markdownPreview" :size="14" />
        <FileCode v-else :size="14" />
        {{ markdownPreview ? "编辑" : "预览" }}
      </button>
    </div>

    <div class="canvas">
      <SessionsView v-if="sessionsOpen" v-show="sessionsFocused" />

      <CompareView
        v-for="tab in compareTabs"
        v-show="compareFocused && tab.id === compareActiveId"
        :key="tab.id"
        :tab-id="tab.id"
        :active="compareFocused && tab.id === compareActiveId"
      />

      <template v-if="showFileEditor && activeTab">
        <CodeMirrorEditor
          v-show="!markdownPreview"
          :key="activeTab.path"
          :path="activeTab.path"
          :content="activeTab.content"
        />
        <div
          v-if="markdownPreview && isMarkdown"
          class="md-preview"
          v-html="previewHtml"
        />
      </template>

      <div
        v-else-if="!sessionsFocused && !compareFocused && !activeTab"
        class="welcome"
      >
        <h1>Miro Code</h1>
        <p>轻量化桌面代码编辑器</p>
        <div class="actions">
          <button type="button" class="cta" @click="workspace.openFolder()">
            打开文件夹…
          </button>
          <button type="button" class="ghost" @click="sessions.openSessions(workspace.rootPath)">
            打开终端
          </button>
          <p class="hint">或使用 ⌘O / Ctrl+O · ⌘P 快速打开 · ⌘` 终端</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.editor-area {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}

.tabs {
  height: 36px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  overflow-x: auto;
}

.tab {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  color: var(--text-muted);
  font-size: 12px;
  max-width: 220px;
}

.tab:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-app) 70%, transparent);
}

.tab.active {
  color: var(--text-primary);
  background: var(--bg-app);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.session-tab .term-icon,
.compare-tab .cmp-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.preview-toggle {
  margin-left: auto;
  margin-bottom: 4px;
  height: 26px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
}

.preview-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--text-muted);
  flex-shrink: 0;
}

.dot.dirty {
  background: var(--accent);
  border-color: var(--accent);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  opacity: 0;
}

.tab:hover .close,
.tab.active .close {
  opacity: 1;
}

.close:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.canvas {
  flex: 1;
  min-height: 0;
  position: relative;
}

.md-preview {
  height: 100%;
  overflow: auto;
  padding: 24px 32px 40vh;
  color: var(--text-primary);
  line-height: 1.7;
}

.md-preview :deep(h1),
.md-preview :deep(h2),
.md-preview :deep(h3) {
  margin: 1.2em 0 0.6em;
}

.md-preview :deep(p),
.md-preview :deep(li) {
  color: var(--text-secondary);
}

.md-preview :deep(code) {
  font-family: var(--font-mono);
  background: var(--accent-soft);
  padding: 2px 6px;
  border-radius: 4px;
}

.md-preview :deep(pre) {
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px;
  overflow: auto;
}

.welcome {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
}

.welcome h1 {
  margin: 0;
  font-size: 28px;
  color: var(--text-primary);
}

.welcome p {
  margin: 0;
}

.actions {
  margin-top: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.cta {
  height: 34px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}

.ghost {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.ghost:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
