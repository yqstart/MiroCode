<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MergeView } from "@codemirror/merge";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { storeToRefs } from "pinia";
import { languageExtensionForPath } from "@/features/editor/languages";
import { editorThemeExtensions } from "@/features/editor/theme";
import { joinPath, writeTextFile } from "@/shared/fs";
import { useCompareStore } from "@/stores/compare";
import { useGitStore } from "@/stores/git";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

const props = defineProps<{
  tabId: string;
  active: boolean;
}>();

const host = ref<HTMLDivElement | null>(null);
const compare = useCompareStore();
const git = useGitStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const { theme } = storeToRefs(settings);

const tab = computed(() => compare.tabs.find((t) => t.id === props.tabId) ?? null);

let mergeView: MergeView | null = null;
let applying = false;
let lastEditable = false;
let resizeObserver: ResizeObserver | null = null;

/** 对比视图专用主题：块状着色，覆盖包默认的底部细线高亮 */
const mergeHighlightTheme = Prec.highest(
  EditorView.theme({
    "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
      backgroundColor: "rgba(248, 113, 113, 0.12)",
    },
    "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
      backgroundColor: "rgba(52, 211, 153, 0.12)",
    },
    "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
      background: "rgba(248, 113, 113, 0.35)",
      borderRadius: "2px",
      color: "inherit",
      textDecoration: "none",
    },
    "&.cm-merge-b .cm-changedText": {
      background: "rgba(52, 211, 153, 0.35)",
      borderRadius: "2px",
      color: "inherit",
      textDecoration: "none",
    },
    "&.cm-merge-b .cm-deletedText": {
      background: "rgba(248, 113, 113, 0.3)",
      borderRadius: "2px",
      textDecoration: "none",
    },
  }),
);

/** MergeView 自身整体滚动；去掉主编辑器 40vh 底垫 */
const mergeLayoutTheme = Prec.highest(
  EditorView.theme({
    "&": {
      height: "auto",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.55",
    },
    ".cm-content": {
      paddingBottom: "24px",
    },
  }),
);

function buildExtensions(path: string, editable: boolean): Extension[] {
  const lang = languageExtensionForPath(path);
  const exts: Extension[] = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    // 语法高亮与配色复用主主题，再用 merge 布局主题覆盖高度/底垫
    ...editorThemeExtensions(theme.value),
    mergeLayoutTheme,
    mergeHighlightTheme,
    EditorView.editable.of(editable),
    EditorState.readOnly.of(!editable),
  ];
  if (lang) exts.push(lang);
  if (editable) {
    exts.push(
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applying) return;
        compare.setRightContent(props.tabId, update.state.doc.toString());
      }),
    );
  }
  return exts;
}

function destroyView() {
  mergeView?.destroy();
  mergeView = null;
}

function measureView() {
  if (!mergeView) return;
  mergeView.a.requestMeasure();
  mergeView.b.requestMeasure();
}

function createView() {
  const current = tab.value;
  if (!host.value || !current || !props.active) return;
  destroyView();
  lastEditable = current.editableRight;

  mergeView = new MergeView({
    parent: host.value,
    orientation: "a-b",
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
    a: {
      doc: current.left,
      extensions: buildExtensions(current.path, false),
    },
    b: {
      doc: current.right,
      extensions: buildExtensions(current.path, current.editableRight),
    },
  });

  // 初次挂载后强制测量，避免容器尚未布局完成时高度为 0
  requestAnimationFrame(() => {
    measureView();
  });
}

function syncDocs() {
  const current = tab.value;
  if (!mergeView || !current) return;
  applying = true;
  const aDoc = mergeView.a.state.doc.toString();
  const bDoc = mergeView.b.state.doc.toString();
  if (aDoc !== current.left) {
    mergeView.a.dispatch({
      changes: { from: 0, to: mergeView.a.state.doc.length, insert: current.left },
    });
  }
  if (bDoc !== current.right) {
    mergeView.b.dispatch({
      changes: { from: 0, to: mergeView.b.state.doc.length, insert: current.right },
    });
  }
  applying = false;
}

async function saveResult() {
  const current = tab.value;
  if (!current || !workspace.rootPath || current.kind !== "merge") return;
  const content = mergeView?.b.state.doc.toString() ?? current.right;
  try {
    const abs = joinPath(workspace.rootPath, current.path);
    await writeTextFile(workspace.rootPath, abs, content);
    await git.resolveConflict(current.path, "manual");
    workspace.showNotice(`已保存并标记解决：${current.path}`);
    compare.closeTab(current.id);
  } catch (error) {
    workspace.showNotice(
      error instanceof Error ? error.message : String(error),
      3200,
    );
  }
}

async function acceptOurs() {
  const current = tab.value;
  if (!current) return;
  await git.resolveConflict(current.path, "ours");
  compare.closeTab(current.id);
}

async function acceptTheirs() {
  const current = tab.value;
  if (!current) return;
  await git.resolveConflict(current.path, "theirs");
  compare.closeTab(current.id);
}

function rebuild() {
  nextTick(() => {
    destroyView();
    createView();
  });
}

function useOursInResult() {
  compare.applySideToResult(props.tabId, "ours");
  rebuild();
}

function useTheirsInResult() {
  compare.applySideToResult(props.tabId, "theirs");
  rebuild();
}

function toggleCompareMode() {
  const current = tab.value;
  if (!current?.conflict) return;
  if (current.editableRight) {
    compare.showOursTheirs(props.tabId);
  } else {
    compare.applySideToResult(props.tabId, "ours");
    const next = tab.value;
    if (next?.conflict) {
      next.right = next.conflict.working || next.conflict.ours;
    }
  }
  rebuild();
}

onMounted(() => {
  createView();
  if (host.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!props.active) return;
      measureView();
    });
    resizeObserver.observe(host.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  destroyView();
});

watch(
  () => props.active,
  async (active) => {
    if (!active) return;
    await nextTick();
    if (!mergeView) {
      createView();
    } else {
      // v-show 切回时容器尺寸变化，需要重新测量对齐 spacer
      measureView();
    }
  },
);

watch(
  () =>
    tab.value
      ? ([tab.value.left, tab.value.right, tab.value.editableRight] as const)
      : null,
  (next) => {
    if (!next || !props.active) return;
    const editable = next[2];
    if (!mergeView || editable !== lastEditable) {
      createView();
      return;
    }
    syncDocs();
  },
);

watch(theme, () => {
  if (props.active) createView();
});
</script>

<template>
  <div class="compare">
    <header v-if="tab" class="toolbar">
      <div class="labels">
        <span class="side">{{ tab.leftLabel }}</span>
        <span class="sep">↔</span>
        <span class="side">{{ tab.rightLabel }}</span>
        <span class="path">{{ tab.path }}</span>
      </div>
      <div v-if="tab.kind === 'merge'" class="actions">
        <button type="button" class="btn" @click="toggleCompareMode">
          {{ tab.editableRight ? "查看双方" : "编辑结果" }}
        </button>
        <button type="button" class="btn" @click="useOursInResult">填入本地</button>
        <button type="button" class="btn" @click="useTheirsInResult">填入远程</button>
        <button type="button" class="btn danger" @click="acceptOurs">保留本地</button>
        <button type="button" class="btn danger" @click="acceptTheirs">保留远程</button>
        <button
          type="button"
          class="btn primary"
          :disabled="!tab.editableRight"
          @click="saveResult"
        >
          保存并解决
        </button>
      </div>
      <div v-else class="actions">
        <span class="hint">只读对比</span>
      </div>
    </header>
    <div ref="host" class="merge-host" />
  </div>
</template>

<style scoped>
.compare {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-app);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.labels {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}

.side {
  font-weight: 600;
  color: var(--accent);
}

.sep {
  color: var(--text-muted);
}

.path {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.btn:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.btn.primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: transparent;
}

.btn.danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hint {
  font-size: 11px;
  color: var(--text-muted);
}

/*
  CodeMirror MergeView 约定：外层 .cm-mergeView 设固定高度 + overflow:auto 才能滚动；
  两侧编辑器内容高度为 auto，由外层统一滚动并对齐。
*/
.merge-host {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.merge-host :deep(.cm-mergeView) {
  height: 100%;
  overflow: auto;
  outline: none;
}

.merge-host :deep(.cm-mergeViewEditors) {
  display: flex;
  align-items: stretch;
  min-height: 100%;
}

.merge-host :deep(.cm-mergeViewEditor) {
  flex: 1;
  min-width: 0;
}

.merge-host :deep(.cm-editor) {
  height: auto;
}

/* 强制块状改动高亮（覆盖 merge 包默认底部 2px 细线） */
.merge-host :deep(.cm-changedText),
.merge-host :deep(.cm-deletedText) {
  background-image: none !important;
  text-decoration: none !important;
  border-radius: 2px;
}

.merge-host :deep(.cm-merge-a .cm-changedText),
.merge-host :deep(.cm-deletedChunk .cm-deletedText) {
  background-color: rgba(248, 113, 113, 0.35) !important;
}

.merge-host :deep(.cm-merge-b .cm-changedText) {
  background-color: rgba(52, 211, 153, 0.35) !important;
}

.merge-host :deep(.cm-merge-a .cm-changedLine),
.merge-host :deep(.cm-deletedChunk) {
  background-color: rgba(248, 113, 113, 0.1);
}

.merge-host :deep(.cm-merge-b .cm-changedLine),
.merge-host :deep(.cm-inlineChangedLine) {
  background-color: rgba(52, 211, 153, 0.1);
}
</style>
