/**
 * AI 补全管理器单例
 *
 * 职责：
 * 1. 状态机管理（disabled/idle/requesting/streaming/error），照搬 LspManager 模式
 * 2. 防抖调度 + 在途请求取消（AbortController + reqId 比对）
 * 3. 发起流式补全请求，聚合增量文本回调
 *
 * 不直接依赖 Pinia store（避免循环依赖），配置由调用方传入。
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  aiCancel,
  aiCompleteStream,
  getAiApiKey,
  onAiDelta,
  onAiDone,
  onAiError,
  type AiCompleteRequest,
} from "@/shared/aiApi";
import { getCompletionTemplate, type CompletionParams } from "./fimTemplates";
import { trimPromptToTokenLimit } from "./promptBudget";
import { getPreset } from "./providers";
import type { AiCompletionPrefs } from "@/shared/types";

// ==================== 类型 ====================

export type AiStatus = "disabled" | "idle" | "requesting" | "streaming" | "error";

/** 补全请求选项（由编辑器扩展传入） */
export interface CompletionRequestOptions {
  filePath: string;
  prefix: string;
  suffix: string;
  language: string;
}

/** 补全结果回调 */
export interface CompletionCallbacks {
  /** 增量文本到达 */
  onDelta: (text: string) => void;
  /** 生成完成 */
  onDone: (fullText: string) => void;
  /** 错误 */
  onError: (msg: string) => void;
}

// ==================== AiManager 单例 ====================

class AiManagerImpl {
  /** 当前状态 */
  private _status: AiStatus = "disabled";
  /** 状态变化订阅者 */
  private statusHandlers: Array<(s: AiStatus) => void> = [];
  /** 当前在途请求 id（防竞态） */
  private currentReqId: string | null = null;
  /** 当前在途请求的事件取消监听 */
  private unlistenFns: UnlistenFn[] = [];
  /** 当前聚合的完整文本 */
  private accumulatedText = "";
  /** 是否启用（用户设置） */
  private _enabled = false;

  get status(): AiStatus {
    return this._status;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /** 统一设置状态并通知订阅者 */
  private setStatus(status: AiStatus): void {
    if (status === this._status) return;
    this._status = status;
    for (const handler of this.statusHandlers) {
      try {
        handler(status);
      } catch {
        // 订阅者异常不影响状态机
      }
    }
  }

  /** 订阅状态变化，返回取消函数（照搬 LspManager.onStatusChange） */
  onStatusChange(handler: (status: AiStatus) => void): () => void {
    this.statusHandlers.push(handler);
    handler(this._status);
    return () => {
      const idx = this.statusHandlers.indexOf(handler);
      if (idx >= 0) this.statusHandlers.splice(idx, 1);
    };
  }

  /** 设置启用状态（由设置面板 / store watcher 调用） */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this.cancelInFlight();
      this.setStatus("disabled");
    } else if (this._status === "disabled") {
      this.setStatus("idle");
    }
  }

  /** 取消在途请求 */
  cancelInFlight(): void {
    if (this.currentReqId) {
      // 通知 Rust 侧终止流读取循环（请求已发出也能中途取消）
      void aiCancel(this.currentReqId).catch(() => {});
      // 取消事件监听
      this.unlistenFns.forEach((fn) => fn());
      this.unlistenFns = [];
      this.currentReqId = null;
    }
    if (this._status === "requesting" || this._status === "streaming") {
      this.setStatus("idle");
    }
  }

  /**
   * 发起一次补全请求（流式）
   *
   * @param opts 编辑器上下文（prefix/suffix/language/filePath）
   * @param prefs AI 配置（从 settings store 传入）
   * @param callbacks 增量/完成/错误回调
   */
  async requestCompletion(
    opts: CompletionRequestOptions,
    prefs: AiCompletionPrefs,
    callbacks: CompletionCallbacks,
  ): Promise<void> {
    // 未启用或配置不完整，不发请求
    if (!this._enabled) return;

    // 取消在途请求
    this.cancelInFlight();

    // 读取 API Key
    const apiKey = await getAiApiKey(prefs.provider);
    if (!apiKey) {
      this.setStatus("error");
      callbacks.onError("API Key 未设置");
      return;
    }

    // 生成唯一 req_id
    const reqId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ai-req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.currentReqId = reqId;
    this.accumulatedText = "";
    this.setStatus("requesting");

    // 注册事件监听
    const unlistenDelta = await onAiDelta(reqId, (text) => {
      // 防竞态：仅处理当前请求的事件
      if (this.currentReqId !== reqId) return;
      this.accumulatedText += text;
      if (this._status !== "streaming") this.setStatus("streaming");
      callbacks.onDelta(text);
    });
    const unlistenDone = await onAiDone(reqId, () => {
      if (this.currentReqId !== reqId) return;
      callbacks.onDone(this.accumulatedText);
      this.cleanup(reqId);
      this.setStatus("idle");
    });
    const unlistenError = await onAiError(reqId, (msg) => {
      if (this.currentReqId !== reqId) return;
      callbacks.onError(msg);
      this.cleanup(reqId);
      this.setStatus("error");
    });
    this.unlistenFns = [unlistenDelta, unlistenDone, unlistenError];

    // 构造补全请求参数（根据 provider 模板自动选择请求端点 + 多行策略）
    const preset = getPreset(prefs.provider);
    const template = getCompletionTemplate(preset?.fimTemplate);
    // Token 预算裁剪：超预算时 prefix 保底部、suffix 保顶部（贴近光标最重要）
    const { prefix: trimmedPrefix, suffix: trimmedSuffix } = trimPromptToTokenLimit(
      opts.prefix,
      opts.suffix,
      prefs.maxPromptTokens,
      prefs.maxTokens,
    );
    const params: CompletionParams = template.buildParams(
      trimmedPrefix,
      trimmedSuffix,
      prefs.maxTokens,
      prefs.temperature,
      prefs.multiline,
    );

    // 构造请求参数
    const req: AiCompleteRequest = {
      reqId,
      apiBase: prefs.apiBase,
      apiKey,
      model: prefs.model,
      mode: params.mode,
      prompt: params.prompt ?? "",
      suffix: params.suffix ?? "",
      messages: params.messages,
      maxTokens: prefs.maxTokens,
      temperature: prefs.temperature,
      stop: params.stop,
    };

    // 发起请求（invoke 立即返回，结果通过事件推送）
    try {
      await aiCompleteStream(req);
    } catch (e) {
      this.cleanup(reqId);
      this.setStatus("error");
      callbacks.onError(String(e));
    }
  }

  /** 清理指定请求的事件监听 */
  private cleanup(reqId: string): void {
    if (this.currentReqId === reqId) {
      this.currentReqId = null;
    }
    this.unlistenFns.forEach((fn) => fn());
    this.unlistenFns = [];
  }
}

export const aiManager = new AiManagerImpl();
