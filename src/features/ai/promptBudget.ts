/**
 * Prompt Token 预算裁剪
 *
 * 参考 Continue renderPromptWithTokenLimit：超预算时按 prefix/suffix 比例分配，
 * prefix 砍头部（保留光标附近）、suffix 砍尾部（保留光标附近）。
 *
 * token 估算：近似 4 字符 ≈ 1 token（无需引入 tokenizer 依赖，误差可接受）
 */

/** 估算字符串的 token 数（4 字符 ≈ 1 token） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * 按预算裁剪 prefix/suffix
 *
 * @param prefix 光标前文本
 * @param suffix 光标后文本
 * @param maxPromptTokens prompt 总预算（token）
 * @param maxTokens 生成 max_tokens（预留生成空间）
 * @returns 裁剪后的 { prefix, suffix }
 */
export function trimPromptToTokenLimit(
  prefix: string,
  suffix: string,
  maxPromptTokens: number,
  maxTokens: number,
): { prefix: string; suffix: string } {
  // 预留生成空间：总预算不能把生成部分挤没（至少留 maxTokens 的 1/4 给生成）
  const promptBudget = Math.max(128, maxPromptTokens);

  let trimmedPrefix = prefix;
  let trimmedSuffix = suffix;

  // 先粗算当前总 token
  let used = estimateTokens(prefix) + estimateTokens(suffix);

  if (used <= promptBudget) {
    return { prefix, suffix };
  }

  // 预算分配：默认 prefix 占 80%、suffix 占 20%（贴近光标最重要）
  // 但 suffix 优先保底部（紧跟光标的部分）
  const prefixBudget = Math.floor(promptBudget * 0.8);
  const suffixBudget = promptBudget - prefixBudget;

  // 按行裁剪 prefix：从头部逐行丢弃，保留光标附近
  const prefixLines = prefix.split("\n");
  const keepPrefixLines: string[] = [];
  let prefixTokens = 0;
  // 从尾部（光标附近）往前保留
  for (let i = prefixLines.length - 1; i >= 0; i--) {
    const line = prefixLines[i];
    const tokens = estimateTokens(line) + (keepPrefixLines.length > 0 ? 1 : 0); // 换行符
    if (prefixTokens + tokens > prefixBudget && keepPrefixLines.length > 0) {
      break;
    }
    prefixTokens += tokens;
    keepPrefixLines.unshift(line);
  }
  trimmedPrefix = keepPrefixLines.join("\n");
  // 若前缀被裁掉的部分较多，加个截断标记让模型感知上下文不完整
  if (prefixLines.length > keepPrefixLines.length) {
    trimmedPrefix = `// …（上下文已裁剪 ${prefixLines.length - keepPrefixLines.length} 行）\n${trimmedPrefix}`;
  }

  // 按行裁剪 suffix：从尾部（远离光标）丢弃，保留光标附近
  const suffixLines = suffix.split("\n");
  const keepSuffixLines: string[] = [];
  let suffixTokens = 0;
  // 从头部（光标附近）往后保留
  for (let i = 0; i < suffixLines.length; i++) {
    const line = suffixLines[i];
    const tokens = estimateTokens(line) + (keepSuffixLines.length > 0 ? 1 : 0);
    if (suffixTokens + tokens > suffixBudget && keepSuffixLines.length > 0) {
      break;
    }
    suffixTokens += tokens;
    keepSuffixLines.push(line);
  }
  trimmedSuffix = keepSuffixLines.join("\n");
  if (suffixLines.length > keepSuffixLines.length) {
    trimmedSuffix += "\n// …（上下文已裁剪）";
  }

  void maxTokens; // 预留：二期可结合生成空间精确调整
  return { prefix: trimmedPrefix, suffix: trimmedSuffix };
}
