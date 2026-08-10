/**
 * AI 补全前端 transport 层
 *
 * 封装与 Rust 侧 commands/ai.rs 的通信：
 * - 凭据：invoke 调用 ai_secret_get / ai_secret_set / ai_secret_remove
 * - 流式补全：invoke 发起 ai_complete_stream + listen 监听 ai://delta|done|error/{reqId} 事件
 *
 * 范式参考 features/lsp/transport.ts
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ==================== 凭据 invoke ====================

/** 读取 provider 的 API Key（从 ~/.mirocode/ai-credentials.json） */
export async function getAiApiKey(provider: string): Promise<string | null> {
  return invoke<string | null>("ai_secret_get", { provider });
}

/** 保存 provider 的 API Key（写入 0600 凭据文件） */
export async function setAiApiKey(provider: string, apiKey: string): Promise<void> {
  return invoke("ai_secret_set", { provider, apiKey });
}

/** 删除 provider 的 API Key */
export async function removeAiApiKey(provider: string): Promise<void> {
  return invoke("ai_secret_remove", { provider });
}

// ==================== 流式补全 ====================

/** chat 消息（用于 chat 模式） */
export interface ChatMessage {
  role: string;
  content: string;
  partial?: boolean;
}

/** 补全请求参数（对应 Rust 侧 AiCompleteRequest） */
export interface AiCompleteRequest {
  reqId: string;
  apiBase: string;
  apiKey: string;
  model: string;
  /** "fim" 走 /completions，"chat" 走 /chat/completions */
  mode: string;
  /** FIM 模式的 prompt 字段 */
  prompt: string;
  /** FIM 模式的 suffix 字段 */
  suffix: string;
  /** chat 模式的 messages（与 prompt/suffix 互斥） */
  messages?: ChatMessage[];
  maxTokens: number;
  temperature: number;
  stop: string[];
}

/** 发起流式补全请求（invoke 立即返回，结果通过事件推送） */
export async function aiCompleteStream(req: AiCompleteRequest): Promise<void> {
  return invoke("ai_complete_stream", {
    req: {
      reqId: req.reqId,
      apiBase: req.apiBase,
      apiKey: req.apiKey,
      model: req.model,
      mode: req.mode,
      prompt: req.prompt,
      suffix: req.suffix,
      messages: req.messages ?? null,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      stop: req.stop,
    },
  });
}

// ==================== 事件 listen ====================

/** 监听增量文本 */
export async function onAiDelta(
  reqId: string,
  handler: (text: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(`ai://delta/${reqId}`, (e) => handler(e.payload));
}

/** 监听生成完成 */
export async function onAiDone(reqId: string, handler: () => void): Promise<UnlistenFn> {
  return listen(`ai://done/${reqId}`, () => handler());
}

/** 监听错误 */
export async function onAiError(
  reqId: string,
  handler: (msg: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(`ai://error/${reqId}`, (e) => handler(e.payload));
}
