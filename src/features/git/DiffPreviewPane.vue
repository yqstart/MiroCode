<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
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
import { gitFileSides } from "@/shared/gitApi";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

const props = defineProps<{
  path: string | null;
}>();

const host = ref<HTMLDivElement | null>(null);
const loading = ref(false);
const error = ref("");
const leftLabel = ref("");
const rightLabel = ref("");

const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const { theme } = storeToRefs(settings);

let mergeView: MergeView | null = null;
let resizeObserver: ResizeObserver | null = null;
let loadSeq = 0;

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
      textDecoration: "none",
    },
    "&.cm-merge-b .cm-changedText": {
      background: "rgba(52, 211, 153, 0.35)",
      borderRadius: "2px",
      textDecoration: "none",
    },
  }),
);

const mergeLayoutTheme = Prec.highest(
  EditorView.theme({
    "&": { height: "100%", fontSize: "12px" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.5",
    },
    ".cm-content": { paddingBottom: "16px" },
  }),
);

function buildExtensions(filePath: string): Extension[] {
  const lang = languageExtensionForPath(filePath);
  const exts: Extension[] = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    ...editorThemeExtensions(theme.value),
    mergeLayoutTheme,
    mergeHighlightTheme,
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
  ];
  if (lang) exts.push(lang);
  return exts;
}

function destroyView() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  mergeView?.destroy();
  mergeView = null;
}

async function load() {
  const seq = ++loadSeq;
  destroyView();
  error.value = "";
  leftLabel.value = "";
  rightLabel.value = "";

  if (!props.path || !workspace.rootPath) return;

  loading.value = true;
  try {
    // 工作区相对 HEAD（未暂存优先展示实际改动）
    const sides = await gitFileSides(workspace.rootPath, props.path, false);
    if (seq !== loadSeq) return;
    leftLabel.value = sides.leftLabel;
    rightLabel.value = sides.rightLabel;
    await nextTick();
    if (!host.value || seq !== loadSeq) return;

    mergeView = new MergeView({
      parent: host.value,
      orientation: "a-b",
      gutter: true,
      a: {
        doc: sides.left,
        extensions: buildExtensions(sides.path),
      },
      b: {
        doc: sides.right,
        extensions: buildExtensions(sides.path),
      },
    });

    resizeObserver = new ResizeObserver(() => {
      mergeView?.a.requestMeasure();
      mergeView?.b.requestMeasure();
    });
    resizeObserver.observe(host.value);
  } catch (e) {
    if (seq !== loadSeq) return;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(
  () => [props.path, workspace.rootPath, theme.value] as const,
  () => {
    void load();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  loadSeq += 1;
  destroyView();
});
</script>

<template>
  <div class="preview">
    <header v-if="path" class="preview-head">
      <span class="file">{{ path }}</span>
      <span v-if="leftLabel || rightLabel" class="labels">
        {{ leftLabel }} → {{ rightLabel }}
      </span>
    </header>
    <div v-if="!path" class="placeholder">选中变更文件以预览 Diff</div>
    <div v-else-if="loading" class="placeholder">加载 Diff…</div>
    <div v-else-if="error" class="placeholder error">{{ error }}</div>
    <div v-show="path && !loading && !error" ref="host" class="host" />
  </div>
</template>

<style scoped>
.preview {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-editor, var(--bg-app));
}

.preview-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--text-muted);
}

.file {
  color: var(--text-secondary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.labels {
  flex-shrink: 0;
  opacity: 0.85;
}

.placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 16px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.placeholder.error {
  color: var(--danger);
}

.host {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.host :deep(.cm-mergeView) {
  height: 100%;
}

.host :deep(.cm-mergeViewEditors) {
  height: 100%;
}
</style>
