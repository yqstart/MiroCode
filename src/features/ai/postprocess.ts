/**
 * 补全后处理（postprocessing）
 *
 * 参考 Continue postprocessing：
 * 1. 剥代码块围栏：去掉模型输出的 ``` 标记（FIM 模型偶发输出）
 * 2. 去重检测：`foo = foo = foo...` 重复建议直接丢弃
 * 3. 括号平衡截断：建议使括号失衡时，截断到最近平衡点
 */

/**
 * 剥掉代码块围栏（``` 或 ~~~ 开头的行，及其后可能的多余闭合）
 *
 * FIM 模型有时会输出 ``` 围栏；ghost text 里应去掉。
 */
export function stripCodeFence(text: string): string {
  // 去掉开头的围栏行
  let result = text.replace(/^\s*(```|~~~)[^\n]*\n?/, "");
  // 去掉末尾残留的围栏（如只有 ``` 一行）
  result = result.replace(/\n?\s*(```|~~~)\s*$/, "");
  return result;
}

/**
 * 重复检测：若建议文本是同一片段的多次重复（编辑距离极低），丢弃
 *
 * 多行场景：拆行后若 80% 以上行与最长行近似，判定重复。
 * 单行场景：按标识符切分后若 token 高度重复，判定重复。
 */
export function isRepetitive(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return false;

  // 多行重复：80% 以上行与最长行相似
  if (lines.length >= 3) {
    const base = lines.reduce((a, b) => (b.length > a.length ? b : a));
    if (base.length >= 4) {
      let similar = 0;
      for (const line of lines) {
        let common = 0;
        const maxLen = Math.max(line.length, base.length);
        while (common < Math.min(line.length, base.length) && line[common] === base[common]) {
          common++;
        }
        if (common / maxLen > 0.7) similar++;
      }
      if (similar / lines.length >= 0.8) return true;
    }
  }

  // 单行重复：形如 `foo = foo = foo = foo`，按 = 切分后 >2 个相同的 token 段
  const single = lines.join(" ");
  if (single.length >= 4) {
    // 用 = 或空格切出片段，检查高频重复
    const parts = single.split(/\s*=\s*|\s{2,}|,\s*/).filter((p) => p.length > 0);
    if (parts.length >= 4) {
      const freq = new Map<string, number>();
      for (const p of parts) freq.set(p, (freq.get(p) ?? 0) + 1);
      const maxFreq = Math.max(...freq.values());
      if (maxFreq >= 3 && maxFreq / parts.length >= 0.7) return true;
    }
  }

  return false;
}

/**
 * 括号平衡截断：若建议使文本括号失衡（多出闭合符），截断到最近平衡点
 *
 * 只处理多出的闭合符场景（模型提前闭合了本不该闭合的括号）。
 * 返回截断后的文本；若已平衡则原样返回。
 */
export function truncateToBalanced(text: string): string {
  let balance = 0;
  const closes: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      balance++;
    } else if (closes[ch]) {
      if (balance <= 0) {
        // 多余闭合符：截断到它之前（此时文本已构成完整表达式）
        return text.slice(0, i).trimEnd();
      }
      balance--;
    }
  }
  // 结尾时 balance >= 0（未闭合或恰好平衡）：原样返回
  return text;
}

/**
 * 完整后处理管道：剥围栏 -> 截断平衡 -> 去重判定
 *
 * @returns 处理后的文本；若判定为劣质建议返回 null
 */
export function postprocessCompletion(text: string): string | null {
  if (!text) return null;
  let result = stripCodeFence(text);
  result = truncateToBalanced(result);
  // 去重判定放在最后（截断后可能消除重复尾部）
  if (isRepetitive(result)) return null;
  return result;
}
