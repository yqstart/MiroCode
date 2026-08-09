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
import { lintGutter, setDiagnostics } from "@codemirror/lint";
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
import { createLspExtension, createLspReferencesKeymap, createDiagnosticsManager, lspRename } from "@/features/lsp/lspExtension";
import { lspManager } from "@/features/lsp/manager";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
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
const git = useGitStore();
const { theme, editor } = storeToRefs(settings);
const { openAt, findRequest } = storeToRefs(editorStore);

let view: EditorView | null = null;
const themeComp = new Compartment();
const langComp = new Compartment();
const prefsComp = new Compartment();
const lspComp = new Compartment();
let applyingExternal = false;

// LSP 诊断合流器（LSP 类型诊断 + ESLint 规则诊断 -> 同一 setDiagnostics）
let diagManager: ReturnType<typeof createDiagnosticsManager> | null = null;

// LSP 文档同步：didChange 防抖
let lspChangeTimer: ReturnType<typeof setTimeout> | null = null;

// LSP 诊断订阅标记（onDiagnostics 只需订阅一次，handler 内引用最新 diagManager）
let lspDiagSubscribed = false;

const eslint = createEslintScheduler(
  () => view,
  {
    filePath: () => props.path,
    workspaceRoot: () => workspace.rootPath,
    enabled: () => editor.value.eslintEnabled,
    onDiagnostics: (diags) => {
      // ESLint 诊断走合流器（与 LSP 类型诊断合流）
      if (diagManager && view) {
        diagManager.setEslintDiagnostics(view, diags);
      } else if (view) {
        // LSP 不可用时直接 setDiagnostics
        view.dispatch(setDiagnostics(view.state, diags));
      }
    },
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

// ==================== LSP 文档同步 ====================

/** 防抖发送 didChange（增量同步） */
function scheduleLspChange(path: string) {
  if (lspChangeTimer != null) clearTimeout(lspChangeTimer);
  lspChangeTimer = setTimeout(() => {
    lspChangeTimer = null;
    if (!view) return;
    // 简化：发送全量文本（增量需跟踪 changes，后续优化）
    const text = view.state.doc.toString();
    void lspManager.didChange(path, [], text);
  }, 300);
}

/** 刷新 LSP 文档同步（挂载/切换文件时调用） */
async function refreshLspDoc(path: string, text: string) {
  // 先 flush 待发送的 didChange
  if (lspChangeTimer != null) {
    clearTimeout(lspChangeTimer);
    lspChangeTimer = null;
  }
  // 设置诊断合流器
  diagManager = createDiagnosticsManager(path);
  // 订阅 LSP 诊断（仅订阅一次，handler 始终引用最新的 diagManager）
  if (!lspDiagSubscribed) {
    lspDiagSubscribed = true;
    lspManager.onDiagnostics((uri, diagnostics) => {
      if (diagManager && view) {
        diagManager.setLspDiagnostics(view, uri, diagnostics);
      }
    });
  }
  // didOpen
  void lspManager.didOpen(path, text);
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
        // 勿用 domEventHandlers 处理 contextmenu：
        // main.ts 已在捕获阶段 preventDefault，CM 会跳过 defaultPrevented 的 handler，导致右键菜单失效。
        // 父级 @contextmenu 通过 Vue 透传到本组件根节点即可。
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        // VS Code 风格查找面板：自研 MiroFindPanel（右上角悬浮、查找/替换两行、
        // 上下箭头、Aa/.*/Ab 切换、结果计数、⌘F/⌘H/⌘G/Esc/F3 等快捷键）。
        // openFindPanel/openFindReplacePanel 已用 requestAnimationFrame 修复
        // panelByView 时序问题（openSearchPanel 后下一帧才 mount 注册）。
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
          // F2：rename symbol（LSP 优先，降级回 v1 正则）
          {
            key: "F2",
            run: (v) => {
              const root = workspace.rootPath;
              if (!root) {
                workspace.showNotice("未打开工作区", 2000);
                return true;
              }
              const newName = window.prompt("重命名为：");
              if (newName == null) return true; // 取消
              void lspRename(v, props.path, root, newName);
              return true;
            },
          },
          indentWithTab,
        ]),
        // 快捷键对齐 VS Code：⌘F 查找；⌘⌥F（mac）/ Ctrl+H（win）替换
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
              key: "Mod-Alt-f",
              run: (v) => {
                openFindReplacePanel(v);
                return true;
              },
            },
            {
              key: "Mod-h",
              run: (v) => {
                openFindReplacePanel(v);
                return true;
              },
            },
          ]),
        ),
        langComp.of(lang ? [lang] : []),
        // LSP 扩展（hover/签名/语义补全/诊断/引用面板）；LSP 不可用时各扩展内部降级
        lspComp.of(createLspExtension(props.path)),
        createLspReferencesKeymap(props.path, () => workspace.rootPath),
        themeComp.of(editorThemeExtensions(theme.value)),
        prefsComp.of(buildPrefs()),
        EditorView.updateListener.of((update) => {
          if (!view) return;
          if (update.docChanged && !applyingExternal) {
            editorStore.setContent(props.path, update.state.doc.toString());
            eslint.schedule();
            // LSP 文档同步：didChange 防抖 300ms
            scheduleLspChange(props.path);
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
  // LSP 文档同步：didOpen
  void refreshLspDoc(props.path, props.content);
}

onMounted(() => {
  createEditor();
  // 编辑器首次挂载时拉一次 git status，避免刚打开文件右键看不到 git 菜单
  void git.refresh();
});

onBeforeUnmount(() => {
  // LSP didClose
  void lspManager.didClose(props.path);
  if (lspChangeTimer != null) {
    clearTimeout(lspChangeTimer);
    lspChangeTimer = null;
  }
  diagManager?.dispose();
  diagManager = null;
  eslint.dispose();
  view?.destroy();
  view = null;
});

watch(
  () => props.path,
  (_newPath, oldPath) => {
    // LSP didClose 旧文件
    if (oldPath) void lspManager.didClose(oldPath);
    if (lspChangeTimer != null) {
      clearTimeout(lspChangeTimer);
      lspChangeTimer = null;
    }
    diagManager?.dispose();
    diagManager = null;
    eslint.dispose();
    view?.destroy();
    view = null;
    // 切换文件后立刻拉一次 git status，避免刚切换就右键时 statusMap 暂空
    // 看不到「显示 Diff / 回滚变更」菜单项。
    void git.refresh();
    createEditor();
  },
);

watch(
  () => props.content,
  (next) => {
    if (!view) return;
    // 断环核心：只有外部修改（syncFromDisk / reloadAfterDiscard /
    // formatDocument / renameSymbol 等）才标记了 pendingExternalUpdate，
    // 此时把新内容 dispatch 进 CM。用户输入触发的 setContent 不标记，
    // watcher 直接 return，彻底切断 CM -> store -> prop -> CM 回环。
    if (!editorStore.consumeExternalUpdate(props.path)) return;
    const current = view.state.doc.toString();
    if (next === current) return;

    // 保留光标位置：记录 dispatch 前的行号+列号，dispatch 后按行号重新定位。
    // 不能用绝对 offset（格式化/外部修改可能改变行数和缩进，offset 会错位）。
    // 用「行号不变、列号取 min(原列, 当前行长度)」策略，对格式化场景足够稳健。
    const sel = view.state.selection.main;
    const headLine = view.state.doc.lineAt(sel.head);
    const savedLine = headLine.number;
    const savedCol = sel.head - headLine.from;
    const anchorLine = view.state.doc.lineAt(sel.anchor);
    const savedAnchorLine = anchorLine.number;
    const savedAnchorCol = sel.anchor - anchorLine.from;

    applyingExternal = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        userEvent: "input.external",
      });
    } finally {
      applyingExternal = false;
    }

    // dispatch 后按行号+列号重新定位光标
    const newDoc = view.state.doc;
    const newLineCount = newDoc.lines;
    const targetLine = Math.min(savedLine, newLineCount);
    const newLineObj = newDoc.line(targetLine);
    const targetHead = newLineObj.from + Math.min(savedCol, newLineObj.length);

    const targetAnchorLine = Math.min(savedAnchorLine, newLineCount);
    const newAnchorLineObj = newDoc.line(targetAnchorLine);
    const targetAnchor =
      newAnchorLineObj.from + Math.min(savedAnchorCol, newAnchorLineObj.length);

    view.dispatch({
      selection: { anchor: targetAnchor, head: targetHead },
      scrollIntoView: false,
    });
  },
);

watch(openAt, (target) => {
  if (!target || target.path !== props.path) return;
  scrollTo(target.line, target.column);
});

// 原生菜单 ⌘F -> store 信号 -> 打开查找面板（macOS 键盘事件被原生层占用时的兜底路由）
watch(findRequest, (req) => {
  if (!req || !view || req.path !== props.path) return;
  openFindPanel(view);
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

/* 文件内查找：VS Code 风格右上角悬浮（CM 内置 .cm-panels-top 容器） */
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

/* VS Code 风格：查找行始终可见；替换行折叠时隐藏 */
.cm-host :deep(.miro-find-row),
.cm-host :deep(.miro-find-replace-row) {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.cm-host :deep(.miro-find-replace-row.is-collapsed) {
  display: none;
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

/* 查找匹配弱于当前选中匹配；选区本身由 theme.selection 控制且应最亮 */
.cm-host :deep(.cm-selectionMatch) {
  background-color: color-mix(in srgb, var(--accent) 16%, transparent) !important;
  border-radius: 2px;
}

.cm-host :deep(.cm-searchMatch) {
  background: color-mix(in srgb, var(--accent) 22%, transparent) !important;
  border-radius: 2px;
}

.cm-host :deep(.cm-searchMatch-selected) {
  background: color-mix(in srgb, var(--accent) 55%, transparent) !important;
  outline: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
}
</style>
