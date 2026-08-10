/**
 * Contextual Filter 触发前过滤
 *
 * 参考 GitHub Copilot 逆向（copilot-explorer）：发请求前算特征分数，
 * 低于阈值就不发请求，避免劣质请求浪费延迟与费用。
 *
 * 特征（对应 Copilot 权重最高的几项）：
 * - 光标前字符是闭合符 `)`/`]`/`}`（语句已闭合）-> 不请求
 * - 光标前字符是开放符 `(`/`[`/`{`（明显需要补全）-> 请求
 * - 光标行是纯注释 -> 不请求（补全价值低）
 * - 光标行空 / 仅缩进（函数体 / 新代码块开头）-> 请求
 */

/**
 * 判断是否值得发起补全请求
 *
 * @param prefix 光标前全文
 * @returns true 发请求；false 跳过
 */
export function shouldRequestCompletion(prefix: string): boolean {
  if (!prefix) return false;

  // 取光标前一个非空白字符（跳过尾部空白）
  const beforeCursor = prefix[prefix.length - 1];
  if (beforeCursor === "\n") {
    // 刚换行：取上一行的上下文判断
    const lines = prefix.split("\n");
    const prevLine = lines[lines.length - 2] ?? "";
    const prevTrimmed = prevLine.trim();
    // 上一行是注释 -> 不请求
    if (prevTrimmed.startsWith("//") || prevTrimmed.startsWith("#") || prevTrimmed.startsWith("*")) {
      return false;
    }
    // 上一行以开放符结尾（if/for/函数签名等）-> 请求
    if (/[(,=\[{]$/.test(prevTrimmed) || /(if|for|while|function|=>)\s*$/.test(prevTrimmed)) {
      return true;
    }
    // 上一行是语句 -> 新行可能继续写代码，请求（低价值但可接受）
    return true;
  }

  // 光标前字符分类
  if (")]}".includes(beforeCursor)) {
    // 语句已闭合，补全价值低 -> 不请求
    return false;
  }
  if ("([{".includes(beforeCursor)) {
    // 明显需要补全 -> 请求
    return true;
  }

  // 光标所在行内容
  const lastNewline = prefix.lastIndexOf("\n");
  const currentLine = prefix.slice(lastNewline + 1);
  const trimmed = currentLine.trim();

  // 纯注释行 -> 不请求
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
    return false;
  }

  // 空行或仅缩进 -> 请求（可能是函数体/块开头）
  if (trimmed.length === 0) {
    return true;
  }

  // 行尾是开放符或运算符 -> 请求
  if (/[(,\[=:{+*/&|?<>-]$/.test(trimmed)) {
    return true;
  }

  // 行尾是闭合符（分号/括号结束）-> 语句已完整，不请求
  if (/[;)}\]]$/.test(trimmed)) {
    return false;
  }

  // 一般输入中 -> 请求（打字过程中补全）
  return true;
}
