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
import { shouldRequestCompletion } from "@/features/ai/contextFilter";
import { StreamFilter } from "@/features/ai/streamFilter";
import { buildSnippetContext } from "@/features/ai/snippets";
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

/** 临时给 widget 挂的过渡态 class（接受/取消时短暂特效） */
const setGhostTransitionEffect = StateEffect.define<
  "accepted" | "dismissed" | null
>();

/** 临时过渡态字段——只用于 widget toDOM 读取，不参与业务逻辑 */
const ghostTransitionField = StateField.define<"accepted" | "dismissed" | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostTransitionEffect)) return e.value;
    }
    return value;
  },
});

class GhostTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly transition: "accepted" | "dismissed" | null = null,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    if (this.transition === "accepted") span.classList.add("just-accepted");
    if (this.transition === "dismissed") span.classList.add("just-dismissed");
    span.textContent = this.text;
    return span;
  }

  /** 避免每次 update 都重建 DOM */
  eq(other: GhostTextWidget): boolean {
    return this.text === other.text && this.transition === other.transition;
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

/** 接受/取消过渡态的 widget 装饰——同一个 set 渲染但 widget 带 transition class */
const transitionRenderPlugin = EditorView.decorations.compute(
  [suggestionField, ghostTransitionField],
  (state) => {
    const suggestion = state.field(suggestionField);
    const transition = state.field(ghostTransitionField);
    if (!suggestion.text || !transition) return Decoration.none;
    const widget = Decoration.widget({
      widget: new GhostTextWidget(suggestion.text, transition),
      side: 1,
    });
    return Decoration.set([widget.range(suggestion.pos)]);
  },
);

// ==================== ViewPlugin(fetch)：防抖触发请求 ====================

/**
 * view -> FetchPlugin 实例注册表：供 Esc dismiss 时标记「已丢弃」并
 * 取消在途 AI 流（模块级函数拿不到插件实例，经 WeakMap 取，view 销毁自动回收）
 */
const fetchPluginInstances = new WeakMap<EditorView, { markDismissed: () => void }>();

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
    /** 流式过滤管道（行级稳定更新 + 300ms 首字提示） */
    private stream: StreamFilter | null = null;
    /** 已按 Esc 丢弃：后续 onDelta/onDone 一律不渲染（防止被 dismiss 的补全复活） */
    private dismissed = false;

    constructor(view: EditorView) {
      fetchPluginInstances.set(view, {
        markDismissed: () => this.markDismissed(),
      });
    }

    /** Esc 丢弃：停止渲染 + 取消在途流，下一次输入重新触发请求 */
    markDismissed(): void {
      this.dismissed = true;
      this.stream?.cancel();
      this.stream = null;
      // 取消 Rust 侧在途流（省 token）；无在途请求时无副作用
      aiManager.cancelInFlight();
    }

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

      // 新一轮输入 = 重置丢弃标记
      this.dismissed = false;

      // Contextual filter：语句已闭合 / 纯注释行等场景跳过，避免劣质请求
      if (!shouldRequestCompletion(prefix)) return;

      // 跨文件 snippet 上下文：从已打开的同语言文件抽取相似片段，拼到 prompt 头部
      // （snippet 段预算取 maxPromptTokens 的 30%，由 token 预算裁剪兜底）
      const snippetBudget = Math.max(128, Math.floor(prefs.maxPromptTokens * 0.3));
      const editorStore = useEditorStore();
      const snippet = buildSnippetContext(filePath, prefix, editorStore.tabs, snippetBudget);
      const fullPrefix = snippet ? snippet + prefix : prefix;

      // 行级稳定更新：完整行 flush / 300ms 首字提示 / 结束 flush 剩余
      const renderStreamText = (): void => {
        const text = this.stream?.displayText() ?? "";
        if (!text) {
          view.dispatch({ effects: clearSuggestionEffect.of(undefined) });
          return;
        }
        view.dispatch({
          effects: setSuggestionEffect.of({
            text,
            pos: view.state.selection.main.head,
            doc: view.state.doc,
          }),
        });
      };
      this.stream = new StreamFilter(
        renderStreamText,
        renderStreamText,
        prefs.showWhateverMs,
      );

      aiManager.requestCompletion(
        { filePath, prefix: fullPrefix, suffix, language },
        prefs,
        {
          onDelta: (text) => {
            // 防竞态：文档已变或已被 Esc 丢弃则丢弃
            if (this.dismissed || view.state.doc !== docSnapshot) return;
            this.stream?.push(text);
          },
          onDone: (fullText) => {
            // 防竞态：文档已变或已被 Esc 丢弃则丢弃
            if (this.dismissed || view.state.doc !== docSnapshot) return;
            // 结束流式，flush 剩余 buffer
            this.stream?.finish();
            // manager 已做后处理（剥围栏/括号截断/去重）；空串表示判定为劣质建议，清除
            const finalText = fullText;
            if (!finalText) {
              view.dispatch({ effects: clearSuggestionEffect.of(undefined) });
              return;
            }
            view.dispatch({
              effects: setSuggestionEffect.of({
                text: finalText,
                pos: view.state.selection.main.head,
                doc: view.state.doc,
              }),
            });
          },
          onError: (_msg) => {
            this.stream?.cancel();
            this.stream = null;
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
      this.stream?.cancel();
      this.stream = null;
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

  // 接受动画：先挂 accepted class（让 widget 跑 0.28s accepted keyframe），
  // 再插入文本 + 清空 ghost。
  // 用调度器（microtask）确保 widget 先用 accepted 装饰渲染一帧再被清除。
  view.dispatch({
    effects: setGhostTransitionEffect.of("accepted"),
  });
  Promise.resolve().then(() => {
    view.dispatch({
      changes: { from: pos, to: pos, insert: text },
      selection: { anchor: pos + text.length },
      userEvent: "input.complete",
      effects: [
        clearSuggestionEffect.of(undefined),
        setGhostTransitionEffect.of(null),
      ],
    });
    editorStore.setContent(filePath, view.state.doc.toString());
  });

  return true;
}

/** 取消 ghost text 补全 */
function dismissSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField, false);
  if (!suggestion?.text) return false;
  // 标记已丢弃 + 取消在途 AI 流：否则流式 delta 到达时（Esc 不改文档，
  // 防竞态 doc 比对恒成立）刚被 dismiss 的 ghost text 会重新渲染「复活」
  fetchPluginInstances.get(view)?.markDismissed();
  // 先挂 dismissed class 让 widget 跑 0.22s fade-out，再清空
  view.dispatch({
    effects: setGhostTransitionEffect.of("dismissed"),
  });
  setTimeout(() => {
    view.dispatch({
      effects: [
        clearSuggestionEffect.of(undefined),
        setGhostTransitionEffect.of(null),
      ],
    });
  }, 220);
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
    ghostTransitionField,
    createFetchPlugin(filePath),
    renderPlugin,
    transitionRenderPlugin,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptSuggestion },
        { key: "Escape", run: dismissSuggestion },
      ]),
    ),
    ghostTextTheme,
  ];
}
