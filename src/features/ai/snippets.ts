/**
 * 跨文件 snippet 上下文
 *
 * 参考 Copilot getPromptHelper + Jaccard matcher：从已打开的同语言文件中
 * 抽取与当前光标附近文本相似的片段，拼到 prompt 头部（`# Compare this snippet` 风格），
 * 给模型提供跨文件关联信息（函数签名、类型定义、工具函数等）。
 *
 * 克制实现：只复用已打开的编辑标签（无磁盘扫描），按行重叠率匹配，
 * snippet 段预算控制在 maxPromptTokens 的 30% 内。
 */

import type { EditorTab } from "@/stores/editor";

/** 从文件内容中提取「与参考行集重叠率最高」的连续行片段 */
function findBestMatch(
  refLines: string[],
  content: string,
  maxLines: number,
): string[] | null {
  const lines = content.split("\n");
  if (lines.length === 0) return null;

  let best: string[] | null = null;
  let bestScore = 0;

  // 窗口滑动，找重叠率最高的窗口（窗口大小 = 参考行数）
  const windowSize = Math.min(refLines.length, 12);
  for (let start = 0; start + windowSize <= lines.length; start++) {
    const window = lines.slice(start, start + windowSize);
    let overlap = 0;
    for (let i = 0; i < windowSize; i++) {
      const a = window[i].trim();
      const b = refLines[i]?.trim() ?? "";
      if (a.length > 0 && a === b) overlap++;
    }
    const score = overlap / windowSize;
    if (score > bestScore) {
      bestScore = score;
      best = window;
    }
  }

  // 只取重叠率 >= 30% 且非零的窗口（太低说明不相关）
  if (best && bestScore >= 0.3) {
    // 向窗口前后延伸几行，提供更多上下文
    const bestStart = lines.indexOf(best[0]);
    const extendBefore = Math.min(3, bestStart);
    const extendAfter = Math.min(maxLines - windowSize - extendBefore, lines.length - bestStart - windowSize);
    return lines.slice(bestStart - extendBefore, bestStart + windowSize + Math.max(0, extendAfter));
  }
  return null;
}

/** 估算 token 数（与 promptBudget 一致：4 字符 ≈ 1 token） */
function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

/**
 * 构建跨文件 snippet 上下文
 *
 * @param filePath 当前文件路径
 * @param currentPrefix 光标前文本（用于匹配相似片段）
 * @param tabs 已打开的编辑标签
 * @param snippetBudget snippet 段 token 预算
 * @returns 拼到 prompt 头部的 snippet 文本（空串表示无匹配或无需添加）
 */
export function buildSnippetContext(
  filePath: string,
  currentPrefix: string,
  tabs: EditorTab[],
  snippetBudget: number,
): string {
  // 参考行：当前文件光标附近最后 12 行（去掉尾行可能不完整的）
  const prefixLines = currentPrefix.split("\n");
  const refLines = prefixLines.slice(-12);

  // 只处理文本标签、排除当前文件、排除图片
  const candidates = tabs.filter(
    (t) =>
      t.path !== filePath &&
      !t.content.includes("\u0000") &&
      !/\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(t.path),
  );
  if (candidates.length === 0) return "";

  // 对每个候选文件找最佳匹配，按重叠率降序取前 2
  const matches: Array<{ path: string; lines: string[]; score: number }> = [];
  for (const tab of candidates) {
    const match = findBestMatch(refLines, tab.content, 20);
    if (match && estimateTokens(match.join("\n")) <= snippetBudget / 2) {
      // 粗略评分：snippet 越短、越贴近文件开头越有价值（头部通常有 import/类型声明）
      const score = match.length * 0.5 + (tab.content.indexOf(match[0] ?? "") >= 0 ? 1 : 0);
      matches.push({ path: tab.path, lines: match, score });
    }
  }
  matches.sort((a, b) => b.score - a.score);

  // 组装 snippet 文本（`# Compare this snippet from <path>` 风格）
  let result = "";
  let usedTokens = 0;
  for (const m of matches.slice(0, 2)) {
    const block = `# Compare this snippet from ${m.path}:\n${m.lines.join("\n")}\n`;
    const tokens = estimateTokens(block);
    if (usedTokens + tokens > snippetBudget) break;
    result += block;
    usedTokens += tokens;
  }
  return result;
}
