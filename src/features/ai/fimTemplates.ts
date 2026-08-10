/**
 * FIM（Fill-In-the-Middle）补全模板
 *
 * 当前仅支持标准 /completions 端点（DeepSeek / 自定义 OpenAI 兼容端点）：
 * - prompt+suffix 字段，API 服务器内部自动处理 FIM token，前端不拼 <|fim_begin|> 等 token
 */

/** FIM 模板接口 */
export interface CompletionTemplate {
  /**
   * 构造请求参数（standard：走 /completions 端点，prompt=prefix, suffix=suffix）
   */
  buildParams(
    prefix: string,
    suffix: string,
    maxTokens: number,
    temperature: number,
  ): CompletionParams;
}

/** 补全请求参数（传给 Rust 后端） */
export interface CompletionParams {
  /** 请求模式："fim" 走 /completions，"chat" 走 /chat/completions */
  mode: "fim" | "chat";
  /** FIM 模式的 prompt 字段，或 chat 模式的 messages */
  prompt?: string;
  suffix?: string;
  messages?: Array<{ role: string; content: string; partial?: boolean }>;
  stop: string[];
}

// ==================== 模板实现 ====================

/**
 * 标准 FIM 模板（DeepSeek / 自定义 OpenAI 兼容端点）
 *
 * 走 /completions 端点，prompt=prefix, suffix=suffix
 * API 服务器内部自动处理 FIM token，前端不拼
 */
const standardTemplate: CompletionTemplate = {
  buildParams(prefix, suffix, _maxTokens, _temperature) {
    return {
      mode: "fim",
      prompt: prefix,
      suffix: suffix,
      stop: ["<|endoftext|>", "<|fim_begin|>", "<|fim_hole|>", "<|fim_end|>"],
    };
  },
};

/** 模板注册表 */
export const COMPLETION_TEMPLATES: Record<string, CompletionTemplate> = {
  standard: standardTemplate,
};

/** 获取指定模板名对应的补全模板，回退到标准 FIM */
export function getCompletionTemplate(name?: string): CompletionTemplate {
  if (name && COMPLETION_TEMPLATES[name]) return COMPLETION_TEMPLATES[name];
  return standardTemplate;
}
