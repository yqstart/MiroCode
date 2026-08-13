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
    // 安全防线 ①：raw HTML 一律转义为纯文本。
    // marked 默认把 <img onerror=...> 等原样透传进 v-html，恶意 .md 可在
    // WebView 上下文执行脚本（含 Tauri IPC 能力）。GitHub 同为转义策略。
    html({ text }) {
      return escapeHtml(text);
    },
    // 安全防线 ②：过滤 javascript:/data: 等危险协议链接，防点击执行脚本
    link({ href, title, text }) {
      // text 为原始未转义文本，必须经 parseInline 解析（其中 raw HTML 会走
      // 上面的 html renderer 被转义，粗体/斜体等正常渲染）
      const content = marked.parseInline(text);
      if (isUnsafeProtocol(href)) {
        return `<span title="${escapeAttr(title ?? "")}">${content}</span>`;
      }
      const hrefAttr = escapeAttr(href ?? "");
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<a href="${hrefAttr}"${titleAttr} target="_blank" rel="noopener noreferrer">${content}</a>`;
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
  return s.replace(/[^a-zA-Z0-9_\-.:/?#@!$&'()*+,;=%]/g, "");
}

/** 危险协议检测：javascript: / vbscript: / data:（data:image 除外）等执行类 URL */
function isUnsafeProtocol(href: string | undefined | null): boolean {
  if (!href) return false;
  const trimmed = href.trim().toLowerCase();
  if (/^(javascript|vbscript)\s*:/.test(trimmed)) return true;
  if (trimmed.startsWith("data:") && !trimmed.startsWith("data:image/")) return true;
  return false;
}

// ==================== 对外 API ====================
/**
 * 同步解析 markdown 文本为 HTML 字符串。
 * 与 marked.parse({ async: false }) 等价，封装后调用方不直接 import marked。
 */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}
