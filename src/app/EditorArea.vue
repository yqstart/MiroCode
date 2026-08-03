<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Columns2, Eye, FileCode, GitCommitHorizontal, Pin, TerminalSquare, X } from "lucide-vue-next";
import { marked } from "marked";
import { storeToRefs } from "pinia";
import CodeMirrorEditor from "@/features/editor/CodeMirrorEditor.vue";
import ImagePreview from "@/features/editor/ImagePreview.vue";
import CompareView from "@/features/git/CompareView.vue";
import GitLogPanel from "@/features/git/GitLogPanel.vue";
import SessionsView from "@/features/sessions/SessionsView.vue";
import { basename, relativeToRoot } from "@/shared/fs";
import { isRasterImagePath, isSvgPath } from "@/shared/media";
import { formatShortcut } from "@/shared/platform";
import { revealInOsExplorer } from "@/shared/revealInOs";
import { useCompareStore } from "@/stores/compare";
import { useEditorStore } from "@/stores/editor";
import { useGitLogStore } from "@/stores/gitLog";
import { useGitStore } from "@/stores/git";
import { useSessionsStore } from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const welcomeShortcutHint = computed(() =>
  t("editor.welcomeHint", {
    open: formatShortcut("mod", "O"),
    quick: formatShortcut("mod", "P"),
    term: formatShortcut("mod", "J"),
  }),
);

const editor = useEditorStore();
const sessions = useSessionsStore();
const compare = useCompareStore();
const gitLog = useGitLogStore();
const workspace = useWorkspaceStore();
const git = useGitStore();
const { tabs, activePath, activeTab } = storeToRefs(editor);
const { rootPath } = storeToRefs(workspace);
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
const {
  open: gitLogOpen,
  isFocused: gitLogFocused,
  tabId: gitLogTabId,
} = storeToRefs(gitLog);

/** Markdown 首次打开默认预览；点「编辑」可切回源码 */
const markdownPreview = ref(true);
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
  () =>
    !sessionsFocused.value &&
    !compareFocused.value &&
    !gitLogFocused.value &&
    Boolean(activeTab.value),
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
  if (isMarkdown.value) return markdownPreview.value ? t("editor.edit") : t("editor.preview");
  if (isSvg.value) return svgPreview.value ? t("editor.source") : t("editor.preview");
  return t("editor.preview");
});

const previewToggleTitle = computed(() => {
  if (isMarkdown.value)
    return markdownPreview.value ? t("editor.editMode") : t("editor.previewMode");
  if (isSvg.value)
    return svgPreview.value ? t("editor.editSvg") : t("editor.previewSvg");
  return "";
});

const previewHtml = computed(() => {
  if (
    !activeTab.value ||
    !markdownPreview.value ||
    !isMarkdown.value ||
    sessionsFocused.value ||
    compareFocused.value ||
    gitLogFocused.value
  ) {
    return "";
  }
  return marked.parse(activeTab.value.content, { async: false }) as string;
});

const hasAnyTab = computed(
  () =>
    tabs.value.length > 0 ||
    sessionsOpen.value ||
    compareTabs.value.length > 0 ||
    gitLogOpen.value,
);

watch(
  () => activeTab.value?.path,
  () => {
    markdownPreview.value = true;
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
  gitLog.blurLog();
  editor.activate(path);
}

function activateSessions() {
  compare.blurCompare();
  gitLog.blurLog();
  sessions.focusSessions();
}

function activateCompare(id: string) {
  sessions.blurSessions();
  gitLog.blurLog();
  compare.activate(id);
}

function activateGitLog() {
  sessions.blurSessions();
  compare.blurCompare();
  gitLog.focusLog();
}

function closeSessionsTab() {
  sessions.closeSessions();
  if (gitLogOpen.value && !editor.activePath && !compareTabs.value.length) {
    gitLog.focusLog();
    return;
  }
  if (compareTabs.value.length && !editor.activePath) {
    compare.focusCompare();
    return;
  }
  if (!editor.activePath && editor.tabs.length) {
    editor.activate(editor.tabs[0].path);
  }
}

function closeGitLogTab() {
  gitLog.closeLog();
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
  if (
    !compare.tabs.length &&
    !sessionsFocused.value &&
    !gitLogFocused.value &&
    editor.activePath
  ) {
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

const editorCtx = ref<{ x: number; y: number; absPath: string } | null>(null);
const tabCtx = ref<{ x: number; y: number; path: string } | null>(null);

const tabCtxIndex = computed(() => {
  if (!tabCtx.value) return -1;
  return tabs.value.findIndex((t) => t.path === tabCtx.value!.path);
});

const tabCtxPinned = computed(() => {
  if (!tabCtx.value) return false;
  return Boolean(tabs.value.find((t) => t.path === tabCtx.value!.path)?.pinned);
});

const tabCtxCanCloseLeft = computed(() => {
  const idx = tabCtxIndex.value;
  if (idx <= 0) return false;
  return tabs.value.slice(0, idx).some((t) => !t.pinned);
});

const tabCtxCanCloseRight = computed(() => {
  const idx = tabCtxIndex.value;
  if (idx < 0 || idx >= tabs.value.length - 1) return false;
  return tabs.value.slice(idx + 1).some((t) => !t.pinned);
});

const tabCtxCanCloseOthers = computed(() => {
  if (!tabCtx.value) return false;
  return tabs.value.some(
    (t) => t.path !== tabCtx.value!.path && !t.pinned,
  );
});

const tabCtxCanCloseAll = computed(() =>
  tabs.value.some((t) => !t.pinned),
);

function clampMenuPos(x: number, y: number, width = 180, height = 220) {
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - width - pad);
  const maxY = Math.max(pad, window.innerHeight - height - pad);
  return {
    x: Math.min(Math.max(pad, x), maxX),
    y: Math.min(Math.max(pad, y), maxY),
  };
}

function onTabContextMenu(event: MouseEvent, path: string) {
  event.preventDefault();
  event.stopPropagation();
  editorCtx.value = null;
  const pos = clampMenuPos(event.clientX, event.clientY);
  tabCtx.value = { x: pos.x, y: pos.y, path };
  activateFile(path);
}

async function runTabMenu(
  action:
    | "pin"
    | "close"
    | "closeOthers"
    | "closeLeft"
    | "closeRight"
    | "closeAll"
    | "revealInOs",
) {
  const path = tabCtx.value?.path;
  tabCtx.value = null;
  if (!path) return;
  if (action === "pin") {
    editor.togglePin(path);
    return;
  }
  if (action === "revealInOs") {
    await revealInOsExplorer(path, (message, ms) =>
      workspace.showNotice(message, ms),
    );
    return;
  }
  if (action === "close") {
    await editor.closeTab(path);
    return;
  }
  if (action === "closeOthers") {
    await editor.closeOtherTabs(path);
    return;
  }
  if (action === "closeLeft") {
    await editor.closeTabsToTheLeft(path);
    return;
  }
  if (action === "closeRight") {
    await editor.closeTabsToTheRight(path);
    return;
  }
  if (action === "closeAll") {
    await editor.closeAllTabs();
  }
}

const editorCtxRelPath = computed(() => {
  if (!editorCtx.value || !rootPath.value) return null;
  return relativeToRoot(rootPath.value, editorCtx.value.absPath);
});

const editorCtxGitEntry = computed(() => {
  const rel = editorCtxRelPath.value;
  if (!rel || rel === ".") return null;
  return git.statusMap.get(rel) ?? null;
});

const canDiscardActive = computed(
  () => Boolean(editorCtxGitEntry.value) && !editorCtxGitEntry.value?.conflicted,
);

function onEditorContextMenu(event: MouseEvent) {
  if (!activeTab.value || !showFileEditor.value) return;
  if (sessionsFocused.value || compareFocused.value || gitLogFocused.value) return;
  if (!rootPath.value) return;
  const rel = relativeToRoot(rootPath.value, activeTab.value.path);
  const entry = git.statusMap.get(rel);
  if (!entry || entry.conflicted) return;
  event.preventDefault();
  editorCtx.value = {
    x: event.clientX,
    y: event.clientY,
    absPath: activeTab.value.path,
  };
}

async function discardFromEditor() {
  const rel = editorCtxRelPath.value;
  const entry = editorCtxGitEntry.value;
  editorCtx.value = null;
  if (!rel || !entry || entry.conflicted) return;
  const isUntracked = entry.status === "untracked";
  const msg = isUntracked
    ? t("editor.discardUntrackedConfirm", { name: basename(rel) })
    : t("editor.discardConfirm", { name: basename(rel) });
  if (!confirm(msg)) return;
  await git.discard([rel]);
}

async function showDiffFromEditor() {
  const rel = editorCtxRelPath.value;
  editorCtx.value = null;
  if (!rel) return;
  await git.showDiff(rel, false);
}

function onDocClick() {
  editorCtx.value = null;
  tabCtx.value = null;
}

onMounted(() => window.addEventListener("click", onDocClick));
onBeforeUnmount(() => window.removeEventListener("click", onDocClick));
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
          :class="{
            active: showFileEditor && tab.path === activePath,
            pinned: tab.pinned,
          }"
          @click="activateFile(tab.path)"
          @auxclick.middle.prevent="editor.closeTab(tab.path)"
          @contextmenu="onTabContextMenu($event, tab.path)"
        >
          <span class="dot" :class="{ dirty: editor.isDirty(tab.path) }" />
          <span class="name">{{ tab.name }}</span>
          <span class="tab-trailing">
            <Pin v-if="tab.pinned" :size="11" class="pin-icon" />
            <span
              class="close"
              :title="t('editor.close')"
              @click.stop="editor.closeTab(tab.path)"
            >
              <X :size="12" />
            </span>
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
          <span
            class="close"
            :title="t('editor.close')"
            @click.stop="closeCompareTab(tab.id)"
          >
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
          <span class="name">{{ t("editor.terminalTab") }}</span>
          <span
            class="close"
            :title="t('editor.closeTerminal')"
            @click.stop="closeSessionsTab"
          >
            <X :size="12" />
          </span>
        </button>

        <button
          v-if="gitLogOpen"
          type="button"
          class="tab gitlog-tab"
          :class="{ active: gitLogFocused }"
          :data-id="gitLogTabId"
          @click="activateGitLog"
          @auxclick.middle.prevent="closeGitLogTab"
        >
          <GitCommitHorizontal :size="12" class="gitlog-icon" />
          <span class="name">{{ t("editor.gitLogTab") }}</span>
          <span
            class="close"
            :title="t('editor.closeGitLog')"
            @click.stop="closeGitLogTab"
          >
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

    <div class="canvas" @contextmenu="onEditorContextMenu">
      <SessionsView v-if="sessionsMounted" v-show="sessionsFocused" />

      <GitLogPanel v-if="gitLogOpen" v-show="gitLogFocused" />

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
        v-else-if="!sessionsFocused && !compareFocused && !gitLogFocused && !activeTab"
        class="welcome"
      >
        <h1>{{ t("app.name") }}</h1>
        <p>{{ t("app.tagline") }}</p>
        <div class="actions">
          <button type="button" class="cta" @click="workspace.openFolder()">
            {{ t("editor.openFolder") }}
          </button>
          <button type="button" class="ghost" @click="sessions.openSessions(workspace.rootPath)">
            {{ t("editor.openTerminal") }}
          </button>
          <p class="hint">{{ welcomeShortcutHint }}</p>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="tabCtx"
        class="tab-ctx"
        :style="{ left: `${tabCtx.x}px`, top: `${tabCtx.y}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <button type="button" @click="runTabMenu('pin')">
          {{ tabCtxPinned ? t("editor.unpin") : t("editor.pin") }}
        </button>
        <button type="button" @click="runTabMenu('revealInOs')">
          {{ t("explorer.revealInOs") }}
        </button>
        <hr />
        <button type="button" @click="runTabMenu('close')">
          {{ t("editor.close") }}
        </button>
        <button
          type="button"
          :disabled="!tabCtxCanCloseOthers"
          @click="runTabMenu('closeOthers')"
        >
          {{ t("editor.closeOthers") }}
        </button>
        <button
          type="button"
          :disabled="!tabCtxCanCloseLeft"
          @click="runTabMenu('closeLeft')"
        >
          {{ t("editor.closeToTheLeft") }}
        </button>
        <button
          type="button"
          :disabled="!tabCtxCanCloseRight"
          @click="runTabMenu('closeRight')"
        >
          {{ t("editor.closeToTheRight") }}
        </button>
        <button
          type="button"
          :disabled="!tabCtxCanCloseAll"
          @click="runTabMenu('closeAll')"
        >
          {{ t("editor.closeAll") }}
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="editorCtx && showFileEditor && canDiscardActive"
        class="editor-ctx"
        :style="{ left: `${editorCtx.x}px`, top: `${editorCtx.y}px` }"
        @click.stop
      >
        <button type="button" @click="showDiffFromEditor">{{ t("editor.showDiff") }}</button>
        <button type="button" class="danger" @click="discardFromEditor">
          {{ t("editor.discardChanges") }}
        </button>
      </div>
    </Teleport>
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
.compare-tab .cmp-icon,
.gitlog-tab .gitlog-icon {
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

/* 固定槽位：钉与关闭重叠，悬停只切换透明度，避免跳动 */
.tab-trailing {
  position: relative;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.tab-trailing .pin-icon,
.tab-trailing .close {
  position: absolute;
  inset: 0;
  margin: auto;
}

.pin-icon {
  color: var(--accent);
  opacity: 0.9;
  pointer-events: none;
}

.tab.pinned .close {
  opacity: 0;
  pointer-events: none;
}

.tab.pinned:hover .close,
.tab.pinned.active:hover .close {
  opacity: 1;
  pointer-events: auto;
}

.tab.pinned:hover .pin-icon,
.tab.pinned.active:hover .pin-icon {
  opacity: 0;
}

.canvas {
  flex: 1;
  min-height: 0;
  position: relative;
  height: 100%;
  overflow: hidden;
}

.canvas > :deep(.log-panel),
.canvas > :deep(.sessions-view) {
  height: 100%;
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

.editor-ctx {
  position: fixed;
  z-index: 80;
  min-width: 160px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
}

.editor-ctx button {
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
}

.editor-ctx button:hover {
  background: var(--accent-soft);
}

.editor-ctx .danger {
  color: var(--danger);
}

.tab-ctx {
  position: fixed;
  z-index: 80;
  min-width: 168px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
}

.tab-ctx button {
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
}

.tab-ctx button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.tab-ctx button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tab-ctx hr {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 4px 0;
}
</style>
