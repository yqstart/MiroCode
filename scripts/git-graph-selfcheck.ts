// ==================== Git Graph 车道布局自测 ====================
import assert from "node:assert/strict";
import { layoutGitGraph } from "../src/features/git/gitGraph.ts";

const graph = layoutGitGraph([
  { id: "merge", parents: ["feature", "main"] },
  { id: "feature", parents: ["base"] },
  { id: "main", parents: ["base"] },
  { id: "base", parents: [] },
]);

assert.equal(graph.length, 4);
assert.equal(graph[0]?.merge, true, "合并提交应标记为 merge");
assert.equal(graph[0]?.lane, 0, "合并提交默认位于最左车道");
assert.deepEqual(graph[0]?.lanesAfter, ["feature", "main"]);
assert.equal(graph[1]?.lane, 0, "第一父提交沿第一车道继续");
assert.ok(
  graph[1]?.connectors.some((line) => line.fromY === 0 && line.toY === 0.5),
  "连续提交应从行顶连接到节点",
);
assert.equal(graph[2]?.lane, 1, "第二父提交沿第二车道绘制");
assert.ok(
  graph[0]?.connectors.some((line) => line.from === 0 && line.to === 1),
  "合并提交应有指向第二父提交的分叉线",
);
assert.ok(
  graph[2]?.connectors.some((line) => line.from === 1 && line.to === 0),
  "第二父提交回到共同祖先时应有合并线",
);

const filtered = layoutGitGraph([
  { id: "tip", parents: ["hidden"] },
  { id: "visible", parents: ["hidden"] },
  { id: "hidden", parents: [] },
]);
assert.equal(filtered[2]?.lane, 0, "隐藏父提交重新出现时应接回原车道");

console.log("Git Graph 车道布局自测通过");
