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
import { createAiGhostTextExtension } from "@/features/editor/aiCompletion/ghostTextExtension";
import { aiManager } from "@/features/ai/manager";
import { createDiagnosticsExtension } from "@/features/editor/diagnostics";
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
import { wordAt } from "@/features/editor/documentSymbols";
import { promptInput } from "@/shared/promptDialog";
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
const aiComp = new Compartment();
let applyingExternal = false;

// LSP 诊断合流器（当前仅消费 LSP 诊断，ESLint 链路已移除）
let diagManager: ReturnType<typeof createDiagnosticsManager> | null = null;

// LSP 文档同步：didChange 防抖
let lspChangeTimer: ReturnType<typeof setTimeout> | null = null;

// LSP 诊断订阅标记（onDiagnostics 只需订阅一次，handler 内引用最新 diagManager）
let lspDiagSubscribed = false;

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

/** 字体大小调节：10-24，每次 ±1，节流 60ms 避免 wheel 抖动 */
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;
let lastFontAdjust = 0;
function adjustFontSize(delta: number) {
  const now = performance.now();
  if (now - lastFontAdjust < 60) return;
  lastFontAdjust = now;
  const cur = settings.editor.fontSize;
  const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, cur + delta));
  if (next === cur) return;
  settings.patchEditor({ fontSize: next });
}

/** ⌘/Ctrl + 滚轮调字号（VS Code 行为：deltaY>0 调小，<0 调大） */
function wheelFontSize(event: WheelEvent): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  event.preventDefault();
  // deltaY 单位约为 ±100/格，1 步为 ±1px
  const step = event.deltaY < 0 ? 1 : -1;
  adjustFontSize(step);
  return true;
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
        // ⌘/Ctrl + 滚轮调字号（VS Code 行为）；只拦截带修饰键的滚轮，其他滚轮照旧滚动。
        EditorView.domEventHandlers({
          wheel: (event) => wheelFontSize(event),
        }),
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
              // Tauri WKWebView 不支持 window.prompt（返回 null 静默失败），
              // 改用应用内 PromptDialog；预填当前光标处符号名
              const current =
                wordAt(v.state.doc.toString(), v.state.selection.main.head)?.word ?? "";
              void promptInput({
                title: "重命名符号",
                label: "新名称",
                defaultValue: current,
                confirmText: "重命名",
              }).then((newName) => {
                if (!newName) return; // 取消 / 空输入
                void lspRename(v, props.path, root, newName);
              });
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
            // ⌥⇧F：格式化当前文件（对齐 VS Code Shift+Alt+F；内置引擎开箱即用）
            {
              key: "Shift-Alt-f",
              run: () => {
                void editorStore.formatDocument();
                return true;
              },
            },
          ]),
        ),
        langComp.of(lang ? [lang] : []),
        // LSP 扩展（hover/签名/语义补全/诊断/引用面板）；LSP 不可用时各扩展内部降级
        lspComp.of(createLspExtension(props.path)),
        createLspReferencesKeymap(props.path, () => workspace.rootPath),
        // AI 行内智能补全（ghost text）；开关由 aiComp 热更新
        aiComp.of(
          editor.value.aiCompletion.enabled
            ? [createAiGhostTextExtension(props.path)]
            : [],
        ),
        themeComp.of(editorThemeExtensions(theme.value)),
        prefsComp.of(buildPrefs()),
        EditorView.updateListener.of((update) => {
          if (!view) return;
          if (update.docChanged && !applyingExternal) {
            editorStore.setContent(props.path, update.state.doc.toString());
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

    // 外部修改（Prettier 格式化 / syncFromDisk / renameSymbol 等）已落地到文档：
    // 该 dispatch 经 applyingExternal 标记，updateListener 中「用户输入」分支不会触发
    // LSP didChange，此处补发，避免 server 内存文本停留在格式化前、诊断/补全位置错位。
    scheduleLspChange(props.path);
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
  },
  { deep: true },
);

// AI 补全开关热更新（Compartment reconfigure）
watch(
  () => editor.value.aiCompletion.enabled,
  (enabled) => {
    aiManager.setEnabled(enabled);
    view?.dispatch({
      effects: aiComp.reconfigure(
        enabled ? [createAiGhostTextExtension(props.path)] : [],
      ),
    });
  },
);

// 组件挂载时同步 AI 开关状态到 manager
onMounted(() => {
  aiManager.setEnabled(editor.value.aiCompletion.enabled);
});

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

/* 替换行：用 max-height + opacity 过渡实现折叠/展开（不依赖 display:none 硬切） */
.cm-host :deep(.miro-find-replace-row) {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-height: 60px;
  opacity: 1;
  overflow: hidden;
  transition: max-height var(--transition-medium) var(--ease-out),
    opacity var(--transition-fast) var(--ease-out),
    margin var(--transition-medium) var(--ease-out);
}
.cm-host :deep(.miro-find-replace-row.is-collapsed) {
  max-height: 0;
  opacity: 0;
  margin-top: -6px;
  pointer-events: none;
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
  /* 选中态从一个匹配跳到另一个时给 0.3s 缓动，避免硬切 */
  transition: background var(--transition-fast) var(--ease-out),
    outline-color var(--transition-fast) var(--ease-out);
}

/* ===== 弹层 enter 动画（CM6 仅提供 enter 钩子，leave 即时移除） ===== */
.cm-host :deep(.cm-tooltip-autocomplete),
.cm-host :deep(.cm-tooltip-hover),
.cm-host :deep(.cm-tooltip-signature) {
  transform-origin: var(--ease-out, 50% 0%);
  animation: miro-tooltip-in var(--transition-medium) var(--ease-out) both;
}

/* completions 选项：箭头键切换时背景平滑 */
.cm-host :deep(.cm-tooltip-autocomplete > ul > li) {
  transition: background var(--transition-fast) var(--ease-out),
    color var(--transition-fast) var(--ease-out);
}

/* find panel 容器 popover 入场 */
.cm-host :deep(.miro-find-panel) {
  transform-origin: top right;
  animation: miro-popover-in var(--transition-medium) var(--ease-out) both;
}

/* find panel 按钮：active/hover 平滑 */
.cm-host :deep(.miro-find-btn) {
  transition: background var(--transition-fast) var(--ease-out),
    color var(--transition-fast) var(--ease-out);
}
.cm-host :deep(.miro-find-text-btn) {
  transition: background var(--transition-fast) var(--ease-out),
    color var(--transition-fast) var(--ease-out),
    border-color var(--transition-fast) var(--ease-out);
}

/* find panel 输入：focus 缓动 */
.cm-host :deep(.miro-find-input) {
  transition: border-color var(--transition-fast) var(--ease-out),
    box-shadow var(--transition-fast) var(--ease-out);
}

/* 匹配数翻牌：scale 0.92 → 1，0.3s 反弹 */
.cm-host :deep(.miro-find-count) {
  display: inline-block;
  transition: color var(--transition-fast) var(--ease-out);
}
.cm-host :deep(.miro-find-count.bump) {
  animation: miro-count-bump 0.32s var(--ease-out);
}
@keyframes miro-count-bump {
  0% {
    transform: scale(0.92);
    opacity: 0.4;
  }
  60% {
    transform: scale(1.06);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* ===== 代码区反馈过渡 ===== */
.cm-host :deep(.cm-activeLine),
.cm-host :deep(.cm-activeLineGutter) {
  transition: background-color var(--transition-fast) var(--ease-out);
}

.cm-host :deep(.cm-selectionMatch) {
  transition: background-color var(--transition-fast) var(--ease-out);
}
.cm-host :deep(.cm-searchMatch) {
  transition: background-color var(--transition-fast) var(--ease-out);
}

/* bracket match 短 pulse：0.3s 一次性高亮（依赖动效，需要在 theme.ts 注入临时 class） */
.cm-host :deep(.cm-matchingBracket) {
  transition: background-color var(--transition-fast) var(--ease-out),
    box-shadow var(--transition-fast) var(--ease-out);
  border-radius: 2px;
}
.cm-host :deep(.cm-matchingBracket.miro-bracket-pulse) {
  animation: miro-bracket-pulse 0.32s var(--ease-out);
}
@keyframes miro-bracket-pulse {
  0% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

/* lint 雪佛龙下划线：出现时淡入（lintGutter 注入的 marker） */
.cm-host :deep(.cm-lintRange-error),
.cm-host :deep(.cm-lintRange-warning) {
  animation: miro-lint-in 0.4s var(--ease-out) both;
}
@keyframes miro-lint-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ghost text：出现时 0.2s 淡入 */
.cm-host :deep(.cm-ghost-text) {
  opacity: 0.4;
  font-style: italic;
  white-space: pre-wrap;
  color: var(--text-muted);
  animation: miro-ghost-in 0.22s var(--ease-out) both;
}
.cm-host :deep(.cm-ghost-text.just-accepted) {
  animation: miro-ghost-accepted 0.28s var(--ease-out) both;
}
.cm-host :deep(.cm-ghost-text.just-dismissed) {
  animation: miro-ghost-dismissed 0.22s var(--ease-out) both;
}
@keyframes miro-ghost-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 0.4;
  }
}
@keyframes miro-ghost-accepted {
  0% {
    opacity: 0.4;
  }
  40% {
    opacity: 0.85;
    color: var(--accent);
  }
  100% {
    opacity: 0;
  }
}
@keyframes miro-ghost-dismissed {
  from {
    opacity: 0.4;
  }
  to {
    opacity: 0;
  }
}
</style>
