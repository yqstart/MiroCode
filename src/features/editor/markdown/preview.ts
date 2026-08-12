// ==================== MD 预览 · marked 封装 ====================
// 集中管理 marked 配置：
// - GFM（表格 / 任务列表 / 删除线 / 自动链接）
// - breaks：把单个 \n 渲染为 <br>（与 GFM 兼容，方便 README 排版）
// - 自定义 code 渲染器：调用自研 highlight 上色
// 单例 renderer，避免每次 parse 都重建。

import { marked } from "marked";
import { highlight } from "./highlight";

// ==================== marked 配置 ====================
marked.use({
  gfm: true,
  breaks: true,
  pedantic: false,
  renderer: {
    // 覆盖默认 code 块：调用自研高亮
    code({ text, lang }) {
      const normLang = (lang ?? "").trim();
      const body = highlight(text, normLang);
      // 复制原始 fence info（class）让用户复制时仍能拿到语言提示
      const langClass = normLang ? ` class="language-${escapeAttr(normLang)}"` : "";
      return `<pre><code${langClass}>${body}</code></pre>`;
    },
    // 行内 code：保持纯文本，不做高亮（高亮是块级的事）
    codespan({ text }) {
      return `<code>${escapeHtml(text)}</code>`;
    },
  },
});

// ==================== 工具 ====================
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "");
}

// ==================== 对外 API ====================
/**
 * 同步解析 markdown 文本为 HTML 字符串。
 * 与 marked.parse({ async: false }) 等价，封装后调用方不直接 import marked。
 */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}
