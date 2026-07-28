<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { storeToRefs } from "pinia";
import { createCompletionExtension } from "@/features/editor/completions";
import { createDiagnosticsExtension } from "@/features/editor/diagnostics";
import { languageExtensionForPath } from "@/features/editor/languages";
import {
  createNavigationExtension,
  goBackKeymap,
  goToDefinitionKeymap,
} from "@/features/editor/navigation";
import { editorThemeExtensions } from "@/features/editor/theme";
import { useEditorStore } from "@/stores/editor";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

const props = defineProps<{
  path: string;
  content: string;
}>();

const host = ref<HTMLDivElement | null>(null);
const editorStore = useEditorStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const { theme, editor } = storeToRefs(settings);
const { openAt } = storeToRefs(editorStore);

let view: EditorView | null = null;
const themeComp = new Compartment();
const langComp = new Compartment();
const prefsComp = new Compartment();
let applyingExternal = false;

const navHandlers = {
  onNavigate: (path: string, line: number, column: number) => {
    void editorStore.openFileAt(path, line, column);
  },
  onGoBack: () => {
    const target = editorStore.popJump();
    if (target) {
      void editorStore.openFileAt(target.path, target.line, target.column);
    }
  },
  workspaceRoot: () => workspace.rootPath,
  currentFile: () => props.path,
};

function buildPrefs() {
  const exts = [
    EditorState.tabSize.of(editor.value.tabSize),
    EditorView.theme({
      "&": { fontSize: `${editor.value.fontSize}px` },
    }),
  ];
  if (editor.value.lineNumbers) {
    exts.push(lineNumbers(), highlightActiveLineGutter());
  }
  if (editor.value.wordWrap) {
    exts.push(EditorView.lineWrapping);
  }
  return exts;
}

function emitCursor(current: EditorView) {
  const head = current.state.selection.main.head;
  const line = current.state.doc.lineAt(head);
  editorStore.setCursor(props.path, line.number, head - line.from + 1);
}

function scrollTo(line: number, column: number) {
  if (!view) return;
  const clampedLine = Math.max(1, Math.min(line, view.state.doc.lines));
  const lineObj = view.state.doc.line(clampedLine);
  const col = Math.max(1, column);
  const pos = lineObj.from + Math.min(col - 1, lineObj.length);
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
  view.focus();
  emitCursor(view);
}

function createEditor() {
  if (!host.value) return;
  const lang = languageExtensionForPath(props.path);

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        highlightSpecialChars(),
        history(),
        foldGutter(),
        lintGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        createCompletionExtension(props.path),
        ...createDiagnosticsExtension(props.path),
        createNavigationExtension(navHandlers),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          goToDefinitionKeymap(navHandlers),
          goBackKeymap(navHandlers),
          indentWithTab,
        ]),
        langComp.of(lang ? [lang] : []),
        themeComp.of(editorThemeExtensions(theme.value)),
        prefsComp.of(buildPrefs()),
        EditorView.updateListener.of((update) => {
          if (!view) return;
          if (update.docChanged && !applyingExternal) {
            editorStore.setContent(props.path, update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            emitCursor(view);
          }
        }),
      ],
    }),
  });
  emitCursor(view);
}

onMounted(() => {
  createEditor();
});

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

watch(
  () => props.path,
  () => {
    view?.destroy();
    view = null;
    createEditor();
  },
);

watch(
  () => props.content,
  (next) => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (next === current) return;
    applyingExternal = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
    applyingExternal = false;
  },
);

watch(openAt, (target) => {
  if (!target || target.path !== props.path) return;
  scrollTo(target.line, target.column);
});

watch(theme, (next) => {
  view?.dispatch({
    effects: themeComp.reconfigure(editorThemeExtensions(next)),
  });
});

watch(
  editor,
  () => {
    view?.dispatch({
      effects: prefsComp.reconfigure(buildPrefs()),
    });
  },
  { deep: true },
);

defineExpose({ scrollTo });
</script>

<template>
  <div ref="host" class="cm-host" />
</template>

<style scoped>
.cm-host {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.cm-host :deep(.cm-editor) {
  height: 100%;
}

.cm-host :deep(.cm-editor.cm-focused) {
  outline: none;
}

.cm-host :deep(.cm-tooltip-autocomplete) {
  border: 1px solid var(--border-subtle) !important;
  background: var(--bg-elevated) !important;
  box-shadow: var(--shadow-modal);
  border-radius: 10px;
  overflow: hidden;
}

.cm-host :deep(.cm-tooltip-autocomplete > ul) {
  font-family: inherit;
  max-height: 280px;
}

.cm-host :deep(.cm-tooltip-autocomplete > ul > li) {
  padding: 4px 10px;
  line-height: 1.45;
}

.cm-host :deep(.cm-tooltip-autocomplete > ul > li[aria-selected]) {
  background: var(--accent-soft) !important;
  color: var(--accent) !important;
}

.cm-host :deep(.cm-completionLabel) {
  color: var(--text-primary);
}

.cm-host :deep(.cm-completionDetail) {
  color: var(--text-muted);
  font-style: normal;
  margin-left: 8px;
}

.cm-host :deep(.cm-completionIcon) {
  opacity: 0.7;
}
</style>
