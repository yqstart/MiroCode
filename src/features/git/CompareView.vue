<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { storeToRefs } from "pinia";
import { editorThemeExtensions } from "@/features/editor/theme";
import { languageExtensionForPath } from "@/features/editor/languages";
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

function buildExtensions(path: string, editable: boolean) {
  const lang = languageExtensionForPath(path);
  const exts = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    editorThemeExtensions(theme.value),
    EditorView.theme({
      "&": { height: "100%", fontSize: "13px" },
      ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
    }),
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

function createView() {
  const current = tab.value;
  if (!host.value || !current) return;
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
});

onBeforeUnmount(() => {
  destroyView();
});

watch(
  () => props.active,
  async (active) => {
    if (active) {
      await nextTick();
      if (!mergeView) createView();
    }
  },
);

watch(
  () =>
    tab.value
      ? [tab.value.left, tab.value.right, tab.value.editableRight] as const
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
  createView();
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

.merge-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.merge-host :deep(.cm-mergeView),
.merge-host :deep(.cm-mergeViewEditors),
.merge-host :deep(.cm-mergeViewEditor),
.merge-host :deep(.cm-editor) {
  height: 100%;
}
</style>
