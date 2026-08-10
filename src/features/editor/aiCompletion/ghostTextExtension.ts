/**
 * AI 行内智能补全 ghost text 扩展（CodeMirror 6）
 *
 * 实现方式（CM6 无原生 inline completion API）：
 * 1. StateField 持有当前建议文本 + 光标位置
 * 2. ViewPlugin(fetch)：防抖触发 AI 补全请求，流式更新建议
 * 3. Decoration.widget 渲染灰色 ghost text（renderPlugin 用 decorations.from）
 * 4. keymap(Tab/Esc)：接受/取消补全（Prec.highest 抢占）
 *
 * 参考：asadm/codemirror-copilot（StateField + 2 ViewPlugin + keymap）
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  type ViewUpdate,
  ViewPlugin,
  keymap,
} from "@codemirror/view";
import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Text,
} from "@codemirror/state";
import { completionStatus } from "@codemirror/autocomplete";

import { aiManager } from "@/features/ai/manager";
import { useSettingsStore } from "@/stores/settings";
import { useEditorStore } from "@/stores/editor";
import { languageFromPath } from "@/shared/fs";

// ==================== StateField：filePath 存储 ====================

/** 当前文件路径（供 FetchPlugin / keymap 读取） */
const filePathField = StateField.define<string>({
  create: () => "",
  update: (v) => v, // 创建时一次性设置，不随 transaction 变化
});

// ==================== StateField：持有当前建议 ====================

interface SuggestionState {
  /** 建议文本（null 表示无建议） */
  text: string | null;
  /** 建议对应的光标位置 */
  pos: number;
  /** 发起建议时的文档快照（防御：文档已变则丢弃） */
  doc: Text | null;
}

const NULL_SUGGESTION: SuggestionState = { text: null, pos: 0, doc: null };

/** 设置建议的 effect */
const setSuggestionEffect = StateEffect.define<{
  text: string | null;
  pos: number;
  doc: Text;
}>();

/** 清除建议的 effect */
const clearSuggestionEffect = StateEffect.define<undefined>();

const suggestionField = StateField.define<SuggestionState>({
  create: () => NULL_SUGGESTION,
  update(value, tr) {
    // 处理 effect
    for (const e of tr.effects) {
      if (e.is(setSuggestionEffect)) {
        // 防御：文档已变则丢弃（避免错位插入）
        if (e.value.doc && e.value.doc !== tr.state.doc) {
          return NULL_SUGGESTION;
        }
        return { text: e.value.text, pos: e.value.pos, doc: e.value.doc };
      }
      if (e.is(clearSuggestionEffect)) {
        return NULL_SUGGESTION;
      }
    }
    // 文档变化或光标移动时清空（除非是接受补全的 input.complete 事件）
    if (tr.docChanged || tr.selection) {
      if (tr.isUserEvent("input.complete")) return value;
      return NULL_SUGGESTION;
    }
    return value;
  },
});

// ==================== Widget：渲染 ghost text ====================

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.textContent = this.text;
    return span;
  }

  /** 避免每次 update 都重建 DOM */
  eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }

  /** widget 不消费事件，让编辑器正常处理 */
  ignoreEvent(): boolean {
    return true;
  }
}

// ==================== 装饰渲染（decorations.from StateField） ====================

const renderPlugin = EditorView.decorations.from(
  suggestionField,
  (suggestion): DecorationSet => {
    if (!suggestion.text) return Decoration.none;
    const widget = Decoration.widget({
      widget: new GhostTextWidget(suggestion.text),
      side: 1, // 放在光标位置之后
    });
    return Decoration.set([widget.range(suggestion.pos)]);
  },
);

// ==================== ViewPlugin(fetch)：防抖触发请求 ====================

/** 构造光标前后的 prefix/suffix */
function buildPrefixSuffix(state: EditorState): { prefix: string; suffix: string } {
  const text = state.doc.toString();
  const head = state.selection.main.head;
  return {
    prefix: text.slice(0, head),
    suffix: text.slice(head),
  };
}

/**
 * 创建防抖 fetch ViewPlugin
 *
 * 用闭包捕获 filePath，避免全局类无法访问 per-editor 状态的问题。
 */
function createFetchPlugin(filePath: string): Extension {
  class FetchPlugin {
    /** 防抖计时器 */
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** 流式聚合的文本 */
    private accumulated = "";

    update(u: ViewUpdate): void {
      // 仅文档变化或光标移动时触发
      if (!u.docChanged && !u.selectionSet) return;
      // 跳过接受补全自身触发的变化（避免死循环）/ 撤销/重做
      // isUserEvent 在 Transaction 上，ViewUpdate 需检查 transactions
      const userEvent = u.transactions
        .map((t) => t.annotation(Transaction.userEvent))
        .filter(Boolean) as string[];
      if (userEvent.some((e) => e.startsWith("input.complete"))) return;
      if (userEvent.includes("undo") || userEvent.includes("redo")) return;

      // 清除已有建议
      const currentState = u.state.field(suggestionField, false);
      if (currentState?.text) {
        u.view.dispatch({ effects: clearSuggestionEffect.of(undefined) });
      }

      // 读取配置
      const settings = useSettingsStore();
      const prefs = settings.settings.editor.aiCompletion;
      if (!prefs.enabled) return;

      // 清除旧计时器
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }

      // 防抖后发起请求
      this.accumulated = "";
      this.timer = setTimeout(() => {
        this.timer = null;
        this.doRequest(u.view);
      }, prefs.debounceMs);
    }

    private doRequest(view: EditorView): void {
      const settings = useSettingsStore();
      const prefs = settings.settings.editor.aiCompletion;
      if (!prefs.enabled) return;

      const state = view.state;
      const docSnapshot = state.doc;
      const { prefix, suffix } = buildPrefixSuffix(state);
      const language = languageFromPath(filePath);

      aiManager.requestCompletion(
        { filePath, prefix, suffix, language },
        prefs,
        {
          onDelta: (text) => {
            // 防竞态：文档已变则丢弃
            if (view.state.doc !== docSnapshot) return;
            this.accumulated += text;
            if (this.accumulated) {
              view.dispatch({
                effects: setSuggestionEffect.of({
                  text: this.accumulated,
                  pos: view.state.selection.main.head,
                  doc: view.state.doc,
                }),
              });
            }
          },
          onDone: (fullText) => {
            // 防竞态：文档已变则丢弃
            if (view.state.doc !== docSnapshot) return;
            // 用 manager 聚合的完整文本（可能比 onDelta 累积的更完整）
            const finalText = fullText || this.accumulated;
            if (!finalText) return;
            view.dispatch({
              effects: setSuggestionEffect.of({
                text: finalText,
                pos: view.state.selection.main.head,
                doc: view.state.doc,
              }),
            });
          },
          onError: (_msg) => {
            view.dispatch({ effects: clearSuggestionEffect.of(undefined) });
          },
        },
      );
    }

    destroy(): void {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
  }

  return ViewPlugin.fromClass(FetchPlugin);
}

// ==================== keymap：Tab 接受 / Esc 取消 ====================

/** 接受 ghost text 补全 */
function acceptSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField, false);
  if (!suggestion?.text) return false;

  // 如果 LSP 补全 popup 打开，不抢占 Tab（让默认 keymap 处理 LSP 项）
  if (completionStatus(view.state) !== null) return false;

  const { text, pos } = suggestion;
  const editorStore = useEditorStore();
  const filePath = view.state.field(filePathField, false) ?? "";

  // ★ 断环：标记外部更新，避免 CM -> store -> prop -> CM 回环
  editorStore.markExternalUpdate(filePath);

  // 插入建议文本
  view.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input.complete",
    effects: clearSuggestionEffect.of(undefined),
  });

  // 同步到 store
  editorStore.setContent(filePath, view.state.doc.toString());

  return true;
}

/** 取消 ghost text 补全 */
function dismissSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField, false);
  if (!suggestion?.text) return false;
  view.dispatch({ effects: clearSuggestionEffect.of(undefined) });
  return true;
}

// ==================== baseTheme ====================

const ghostTextTheme = EditorView.baseTheme({
  ".cm-ghost-text": {
    opacity: "0.4",
    fontStyle: "italic",
    whiteSpace: "pre-wrap",
    color: "var(--text-muted, currentColor)",
  },
});

// ==================== 导出 ====================

/**
 * 创建 AI ghost text 扩展
 *
 * @param filePath 当前文件路径（用于构造 prompt 和断环）
 */
export function createAiGhostTextExtension(filePath: string): Extension {
  return [
    filePathField.init(() => filePath),
    suggestionField,
    createFetchPlugin(filePath),
    renderPlugin,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptSuggestion },
        { key: "Escape", run: dismissSuggestion },
      ]),
    ),
    ghostTextTheme,
  ];
}
