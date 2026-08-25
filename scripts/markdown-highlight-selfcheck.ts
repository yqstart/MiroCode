import assert from "node:assert/strict";
import { highlight } from "../src/features/editor/markdown/highlight.ts";

function assertSafeHtml(code: string, lang: string): string {
  const html = highlight(code, lang);
  assert.doesNotMatch(html, /<span\s+<|<span[^>]*<span/, `${lang} 输出出现嵌套/损坏 span: ${html}`);
  assert.doesNotMatch(html, /<img\s|<script\s/i, `原始 HTML 未转义: ${html}`);
  return html;
}

const js = assertSafeHtml(`const text = "return 42"; // note\nconst n = 1;`, "js");
assert.match(js, /<span class="tk-string">&quot;return 42&quot;<\/span>/);
assert.match(js, /<span class="tk-comment">\/\/ note<\/span>/);
assert.match(js, /<span class="tk-number">1<\/span>/);
assert.match(js, /<span class="tk-keyword">const<\/span>/);

const json = assertSafeHtml(`{ "name": "value", "count": 42 }`, "json");
assert.match(json, /<span class="tk-string">&quot;name&quot;<\/span>/);
assert.match(json, /<span class="tk-number">42<\/span>/);

const python = assertSafeHtml(`def run():\n    return "hello 42"`, "python");
assert.match(python, /<span class="tk-string">&quot;hello 42&quot;<\/span>/);
assert.match(python, /<span class="tk-keyword">return<\/span>/);

const escaped = assertSafeHtml(`<img src=x onerror="alert(1)">`, "js");
assert.match(escaped, /&lt;img/);
assert.doesNotMatch(escaped, /onerror=alert/);

console.log("Markdown 高亮自测通过");
