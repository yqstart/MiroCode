/**
 * FIM（Fill-In-the-Middle）补全模板
 *
 * 当前仅支持标准 /completions 端点（DeepSeek / 自定义 OpenAI 兼容端点）：
 * - prompt+suffix 字段，API 服务器内部自动处理 FIM token，前端不拼 <|fim_begin|> 等 token
 *
 * 多行策略：通过 stop tokens 控制。
 * - never：stop 加 "\n"，模型在第一个换行处停止（单行补全）
 * - auto：启发式判断（末行未闭合 -> 多行；末行已闭合 / 单行注释 / 行内 -> 单行）
 * - always：不加 "\n" stop（始终多行）
 */

export type MultilineMode = "auto" | "always" | "never";

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
    multiline: MultilineMode,
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

/** 判断 prefix 是否应走单行补全（auto 模式启发式） */
export function shouldSingleLine(prefix: string): boolean {
  // 取光标所在行（最后一个换行之后）
  const lastNewline = prefix.lastIndexOf("\n");
  const currentLine = prefix.slice(lastNewline + 1);

  // 行首是注释 -> 单行
  const trimmed = currentLine.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
    return true;
  }

  // 行尾是闭合符（语句已完成）-> 单行
  if (/[;)}\]]$/.test(currentLine.trim())) {
    return true;
  }

  // 行尾是开放符（表达式未完成）-> 多行
  if (/[(,\[=:{+*/&|?<>-]$/.test(currentLine.trim())) {
    return false;
  }

  // 整个 prefix 存在未闭合的开放括号 -> 多行
  if (hasUnclosedBracket(prefix)) {
    return false;
  }

  // 行内空 -> 多行（如函数体开头）
  return currentLine.trim().length === 0 ? false : true;
}

/** 检查文本中是否存在未闭合的开放括号（忽略字符串/注释内的） */
function hasUnclosedBracket(text: string): boolean {
  const stack: string[] = [];
  let inString: string | null = null;
  let inLineComment = false;
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i++; // 跳过转义字符
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.length > 0 && stack[stack.length - 1] === pairs[ch]) {
        stack.pop();
      } else {
        return false; // 多余的闭合括号，视为已闭合
      }
    }
  }
  return stack.length > 0;
}

// ==================== 模板实现 ====================

/**
 * 标准 FIM 模板（DeepSeek / 自定义 OpenAI 兼容端点）
 *
 * 走 /completions 端点，prompt=prefix, suffix=suffix
 * API 服务器内部自动处理 FIM token，前端不拼
 */
const standardTemplate: CompletionTemplate = {
  buildParams(prefix, suffix, _maxTokens, _temperature, multiline) {
    // 基础 stop tokens（FIM 边界符）
    const stop = ["<|endoftext|>", "<|fim_begin|>", "<|fim_hole|>", "<|fim_end|>"];

    // 单行策略：never 恒单行；auto 按启发式
    if (multiline === "never" || (multiline === "auto" && shouldSingleLine(prefix))) {
      stop.unshift("\n");
    }

    return {
      mode: "fim",
      prompt: prefix,
      suffix: suffix,
      stop,
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
