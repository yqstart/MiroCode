// ==================== 跳转目标高亮自测 ====================
// 覆盖普通标识符、标点、空行以及越界位置，避免跳转标记因边界值失效。

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Text } from "@codemirror/state";
import { createServer } from "vite";

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { "@": resolve(root, "src") } },
});

try {
  const { createJumpHighlightTarget } = await server.ssrLoadModule(
    "/src/features/editor/jumpHighlight.ts",
  );
  const doc = Text.of(["const target = true;", "", "  target();"]);

  const wordPos = doc.toString().indexOf("target");
  assert.deepEqual(
    createJumpHighlightTarget(doc, wordPos),
    { from: wordPos, to: wordPos + "target".length, lineFrom: 0 },
    "标识符目标应高亮完整单词",
  );

  const punctuationPos = doc.toString().indexOf("=");
  assert.deepEqual(
    createJumpHighlightTarget(doc, punctuationPos),
    { from: punctuationPos, to: punctuationPos + 1, lineFrom: 0 },
    "非标识符目标至少应高亮一个字符",
  );

  const emptyLineFrom = doc.line(2).from;
  assert.deepEqual(
    createJumpHighlightTarget(doc, emptyLineFrom),
    { from: emptyLineFrom, to: emptyLineFrom, lineFrom: emptyLineFrom },
    "空行目标应保留行高亮而不创建非法范围",
  );

  const lastLineFrom = doc.line(3).from;
  assert.deepEqual(
    createJumpHighlightTarget(doc, doc.length + 100),
    { from: doc.length, to: doc.length, lineFrom: lastLineFrom },
    "越界目标应被限制到文档末尾",
  );
} finally {
  await server.close();
}

console.log("跳转目标高亮自测通过");
