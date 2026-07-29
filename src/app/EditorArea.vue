<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Columns2, Eye, FileCode, TerminalSquare, X } from "lucide-vue-next";
import { marked } from "marked";
import { storeToRefs } from "pinia";
import CodeMirrorEditor from "@/features/editor/CodeMirrorEditor.vue";
import ImagePreview from "@/features/editor/ImagePreview.vue";
import CompareView from "@/features/git/CompareView.vue";
import SessionsView from "@/features/sessions/SessionsView.vue";
import { isRasterImagePath, isSvgPath } from "@/shared/media";
import { formatShortcut } from "@/shared/platform";
import { useCompareStore } from "@/stores/compare";
import { useEditorStore } from "@/stores/editor";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

const welcomeShortcutHint = `或使用 ${formatShortcut("mod", "O")} · ${formatShortcut("mod", "P")} 快速打开 · ${formatShortcut("mod", "J")} 终端`;

const editor = useEditorStore();
const sessions = useSessionsStore();
const compare = useCompareStore();
const workspace = useWorkspaceStore();
const { tabs, activePath, activeTab } = storeToRefs(editor);
const {
  open: sessionsOpen,
  mounted: sessionsMounted,
  isFocused: sessionsFocused,
  tabId: sessionsTabId,
} = storeToRefs(sessions);
const {
  tabs: compareTabs,
  activeId: compareActiveId,
  isFocused: compareFocused,
} = storeToRefs(compare);

const markdownPreview = ref(false);
const svgPreview = ref(true);

const isMarkdown = computed(() => {
  const name = activeTab.value?.name.toLowerCase() ?? "";
  return name.endsWith(".md") || name.endsWith(".markdown");
});

const isSvg = computed(() =>
  activeTab.value ? isSvgPath(activeTab.value.path) : false,
);

const isRaster = computed(() =>
  activeTab.value ? isRasterImagePath(activeTab.value.path) : false,
);

const showFileEditor = computed(
  () => !sessionsFocused.value && !compareFocused.value && Boolean(activeTab.value),
);

const showImagePreview = computed(
  () =>
    showFileEditor.value &&
    Boolean(activeTab.value) &&
    (isRaster.value || (isSvg.value && svgPreview.value)),
);

const showTextEditor = computed(
  () =>
    showFileEditor.value &&
    Boolean(activeTab.value) &&
    !isRaster.value &&
    !(isMarkdown.value && markdownPreview.value) &&
    !(isSvg.value && svgPreview.value),
);

const canTogglePreview = computed(
  () =>
    showFileEditor.value &&
    Boolean(activeTab.value) &&
    (isMarkdown.value || isSvg.value),
);

const previewShowing = computed(() =>
  isMarkdown.value ? markdownPreview.value : isSvg.value ? svgPreview.value : false,
);

const previewToggleLabel = computed(() => {
  if (isMarkdown.value) return markdownPreview.value ? "编辑" : "预览";
  if (isSvg.value) return svgPreview.value ? "源码" : "预览";
  return "预览";
});

const previewToggleTitle = computed(() => {
  if (isMarkdown.value) return markdownPreview.value ? "编辑模式" : "预览模式";
  if (isSvg.value) return svgPreview.value ? "编辑 SVG 源码" : "预览 SVG";
  return "";
});

const previewHtml = computed(() => {
  if (
    !activeTab.value ||
    !markdownPreview.value ||
    !isMarkdown.value ||
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

watch(
  () => activeTab.value?.path,
  () => {
    markdownPreview.value = false;
    svgPreview.value = true;
  },
);

function togglePreview() {
  if (!canTogglePreview.value) return;
  if (isMarkdown.value) {
    markdownPreview.value = !markdownPreview.value;
    return;
  }
  if (isSvg.value) {
    svgPreview.value = !svgPreview.value;
  }
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

/** 标签栏：滚轮纵向 → 横向滚动，不显示滚动条 */
function onTabsWheel(event: WheelEvent) {
  const el = event.currentTarget as HTMLElement;
  if (el.scrollWidth <= el.clientWidth) return;
  const delta =
    Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
  if (!delta) return;
  el.scrollLeft += delta;
}
</script>

<template>
  <section class="editor-area">
    <div v-if="hasAnyTab" class="tabs">
      <div class="tabs-scroll" @wheel.prevent="onTabsWheel">
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
          <span class="close" title="关闭终端（结束会话）" @click.stop="closeSessionsTab">
            <X :size="12" />
          </span>
        </button>
      </div>

      <button
        v-if="canTogglePreview"
        type="button"
        class="preview-toggle"
        :title="previewToggleTitle"
        @click="togglePreview"
      >
        <Eye v-if="!previewShowing" :size="14" />
        <FileCode v-else :size="14" />
        {{ previewToggleLabel }}
      </button>
    </div>

    <div class="canvas">
      <SessionsView v-if="sessionsMounted" v-show="sessionsFocused" />

      <CompareView
        v-for="tab in compareTabs"
        v-show="compareFocused && tab.id === compareActiveId"
        :key="tab.id"
        :tab-id="tab.id"
        :active="compareFocused && tab.id === compareActiveId"
      />

      <template v-if="showFileEditor && activeTab">
        <ImagePreview
          v-if="showImagePreview"
          :path="activeTab.path"
          :content="isSvg ? activeTab.content : undefined"
          :cache-key="activeTab.previewNonce"
        />
        <CodeMirrorEditor
          v-else-if="showTextEditor"
          :key="activeTab.path"
          :path="activeTab.path"
          :content="activeTab.content"
        />
        <div
          v-else-if="markdownPreview && isMarkdown"
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
          <p class="hint">{{ welcomeShortcutHint }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.editor-area {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}

.tabs {
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  overflow: hidden;
}

.tabs-scroll {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/旧 Edge */
}

.tabs-scroll::-webkit-scrollbar {
  display: none; /* Chromium / WebKit */
  width: 0;
  height: 0;
}

.tab {
  height: 30px;
  flex-shrink: 0;
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
  flex-shrink: 0;
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
  height: 100%;
  overflow: hidden;
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
