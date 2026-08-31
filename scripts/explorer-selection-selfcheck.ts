import assert from "node:assert/strict";
import { getPathRange } from "../src/features/explorer/selection.ts";

const visiblePaths = ["a.ts", "b.ts", "c.ts", "d.ts"];

assert.deepEqual(
  getPathRange(visiblePaths, "a.ts", "c.ts"),
  ["a.ts", "b.ts", "c.ts"],
);
assert.deepEqual(
  getPathRange(visiblePaths, "d.ts", "b.ts"),
  ["b.ts", "c.ts", "d.ts"],
);
assert.deepEqual(getPathRange(visiblePaths, "missing.ts", "c.ts"), ["c.ts"]);
assert.deepEqual(getPathRange(visiblePaths, null, "c.ts"), ["c.ts"]);

console.log("资源管理器选择范围自测通过");
