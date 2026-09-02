import assert from "node:assert/strict";
import {
  getContextSelectionPaths,
  getPathRange,
  getTopLevelSelectionPaths,
} from "../src/features/explorer/selection.ts";
import { isUpdateImportsOnMove } from "../src/shared/types.ts";

const visiblePaths = ["a.ts", "b.ts", "c.ts", "d.ts"];

assert.deepEqual(getPathRange(visiblePaths, "a.ts", "c.ts"), [
  "a.ts",
  "b.ts",
  "c.ts",
]);
assert.deepEqual(getPathRange(visiblePaths, "d.ts", "b.ts"), [
  "b.ts",
  "c.ts",
  "d.ts",
]);
assert.deepEqual(getPathRange(visiblePaths, "missing.ts", "c.ts"), ["c.ts"]);
assert.deepEqual(getPathRange(visiblePaths, null, "c.ts"), ["c.ts"]);

assert.deepEqual(getContextSelectionPaths(["a.ts", "b.ts", "c.ts"], "b.ts"), [
  "a.ts",
  "b.ts",
  "c.ts",
]);
assert.deepEqual(getContextSelectionPaths(["a.ts", "b.ts"], "d.ts"), ["d.ts"]);
assert.deepEqual(
  getTopLevelSelectionPaths(["src", "src/a.ts", "src/lib/b.ts", "README.md"]),
  ["src", "README.md"],
);
assert.deepEqual(
  getTopLevelSelectionPaths(["a\\folder", "a/folder/file.ts", "b.ts"]),
  ["a\\folder", "b.ts"],
);
assert.equal(isUpdateImportsOnMove("always"), true);
assert.equal(isUpdateImportsOnMove("prompt"), true);
assert.equal(isUpdateImportsOnMove("never"), true);
assert.equal(isUpdateImportsOnMove("invalid"), false);

console.log("资源管理器选择范围自测通过");
