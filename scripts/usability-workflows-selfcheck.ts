// ==================== 核心可用性工作流自测 ====================

import assert from "node:assert/strict";
import {
  recordNavigation,
  takeNavigationBack,
  takeNavigationForward,
} from "../src/features/editor/navigationHistory.ts";
import {
  parseQuickOpenQuery,
  rankQuickOpenResults,
} from "../src/features/search/quickOpen.ts";
import {
  childCommitId,
  parentCommitId,
  preferredCommitId,
  preferredVisibleCommitId,
} from "../src/features/git/gitLogNavigation.ts";

const a = { path: "/project/a.ts", line: 3, column: 2 };
const b = { path: "/project/b.ts", line: 8, column: 1 };
const c = { path: "/project/c.ts", line: 13, column: 5 };
const history = { back: [], forward: [] } as {
  back: typeof a[];
  forward: typeof a[];
};

recordNavigation(history, a);
recordNavigation(history, b);
assert.deepEqual(takeNavigationBack(history, c), b, "第一次后退应回到 B");
assert.deepEqual(takeNavigationBack(history, b), a, "第二次后退应继续回到 A");
assert.deepEqual(takeNavigationForward(history, a), b, "前进应回到 B");
recordNavigation(history, b);
assert.equal(history.forward.length, 0, "产生新跳转后必须清空旧前进分支");

assert.deepEqual(parseQuickOpenQuery("src/main.ts:42:7"), {
  searchText: "src/main.ts",
  line: 42,
  column: 7,
});
assert.deepEqual(parseQuickOpenQuery("C:\\repo\\main.ts:12"), {
  searchText: "C:\\repo\\main.ts",
  line: 12,
  column: 1,
});
assert.equal(parseQuickOpenQuery("index.vue").line, null);

const ranked = rankQuickOpenResults(
  [
    { path: "/project/a/index.vue", name: "index.vue", relative: "a/index.vue", score: 200 },
    { path: "/project/z/index.vue", name: "index.vue", relative: "z/index.vue", score: 200 },
  ],
  ["/project/z/index.vue"],
);
assert.equal(ranked[0]?.path, "/project/z/index.vue", "同分文件应优先最近访问项");

const commits = [
  { id: "child", parents: ["head"] },
  { id: "head", parents: ["base"] },
  { id: "base", parents: [] },
];
assert.equal(preferredCommitId(commits, "head"), "head");
assert.equal(
  preferredVisibleCommitId(commits, ["child", "base"], "head"),
  "child",
  "HEAD 被过滤时应选中最新的可见提交",
);
assert.equal(parentCommitId(commits, "head"), "base");
assert.equal(childCommitId(commits, "head"), "child");

console.log("核心可用性工作流自测通过");
