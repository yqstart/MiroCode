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
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
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
import { createEslintScheduler } from "@/features/editor/eslintLinter";
import { languageExtensionForPath } from "@/features/editor/languages";
import {
  createNavigationExtension,
  goBackKeymap,
  goToDefinitionKeymap,
} from "@/features/editor/navigation";
import { editorThemeExtensions } from "@/features/editor/theme";
import { createMiroFindPanel, openFindPanel, openFindReplacePanel } from "@/features/editor/findPanel";
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

const eslint = createEslintScheduler(
  () => view,
  {
    filePath: () => props.path,
    workspaceRoot: () => workspace.rootPath,
    enabled: () => editor.value.eslintEnabled,
  },
);

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
        search({ top: true, createPanel: createMiroFindPanel }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...goToDefinitionKeymap(navHandlers),
          goBackKeymap(navHandlers),
          indentWithTab,
        ]),
        Prec.highest(
          keymap.of([
            {
              key: "Mod-f",
              run: (v) => {
                openFindPanel(v);
                return true;
              },
            },
            {
              key: "Mod-r",
              run: (v) => {
                openFindReplacePanel(v);
                return true;
              },
            },
            {
              key: "Mod-Alt-f",
              run: (v) => {
                openFindReplacePanel(v);
                return true;
              },
            },
          ]),
        ),
        langComp.of(lang ? [lang] : []),
        themeComp.of(editorThemeExtensions(theme.value)),
        prefsComp.of(buildPrefs()),
        EditorView.updateListener.of((update) => {
          if (!view) return;
          if (update.docChanged && !applyingExternal) {
            editorStore.setContent(props.path, update.state.doc.toString());
            eslint.schedule();
          }
          if (update.selectionSet || update.docChanged) {
            emitCursor(view);
          }
        }),
      ],
    }),
  });
  emitCursor(view);
  eslint.schedule();
}

onMounted(() => {
  createEditor();
});

onBeforeUnmount(() => {
  eslint.dispose();
  view?.destroy();
  view = null;
});

watch(
  () => props.path,
  () => {
    eslint.dispose();
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
    eslint.schedule();
  },
  { deep: true },
);

watch(
  () => editor.value.eslintEnabled,
  () => {
    void eslint.runNow();
  },
);

defineExpose({ scrollTo });
</script>

<template>
  <div ref="host" class="cm-host" />
</template>

<style scoped>
.cm-host {
  position: relative;
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

/* 文件内查找：VS Code 风格右上角悬浮 */
.cm-host :deep(.cm-panels-top) {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 12;
  pointer-events: none;
}

.cm-host :deep(.cm-panels-top .cm-panel) {
  pointer-events: auto;
}

.cm-host :deep(.miro-find-panel) {
  position: absolute;
  top: 10px;
  right: 14px;
  width: min(520px, calc(100% - 28px));
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cm-host :deep(.miro-find-row),
.cm-host :deep(.miro-find-replace-row.is-collapsed) {
  display: none;
}

.cm-host :deep(.miro-find-replace-row) {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.cm-host :deep(.miro-find-spacer) {
  width: 24px;
  flex-shrink: 0;
}

.cm-host :deep(.miro-find-input) {
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 12px;
}

.cm-host :deep(.miro-find-input:focus) {
  outline: none;
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border-subtle));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-soft) 70%, transparent);
}

.cm-host :deep(.miro-find-count) {
  flex: 0 0 auto;
  min-width: 52px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  white-space: nowrap;
}

.cm-host :deep(.miro-find-btn) {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
  display: grid;
  place-items: center;
}

.cm-host :deep(.miro-find-btn:hover) {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.cm-host :deep(.miro-find-btn.active) {
  background: var(--accent-soft);
  color: var(--accent);
}

.cm-host :deep(.miro-find-btn.toggle-replace) {
  width: 24px;
  font-size: 10px;
}

.cm-host :deep(.miro-find-toggle) {
  font-size: 11px;
  font-weight: 600;
}

.cm-host :deep(.miro-find-replace-actions) {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.cm-host :deep(.miro-find-text-btn) {
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.cm-host :deep(.miro-find-text-btn:hover) {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.cm-host :deep(.cm-searchMatch) {
  background: color-mix(in srgb, var(--accent) 28%, transparent) !important;
  border-radius: 2px;
}

.cm-host :deep(.cm-searchMatch-selected) {
  background: color-mix(in srgb, var(--accent) 52%, transparent) !important;
  outline: 1px solid color-mix(in srgb, var(--accent) 65%, transparent);
}
</style>
