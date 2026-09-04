// ==================== 全局搜索键盘导航自测 ====================

import { getSearchKeyAction } from "../src/features/search/navigation.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let failed = 0;
let passed = 0;

function assert(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

function key(
  value: string,
  overrides: Partial<Pick<KeyboardEvent, "shiftKey" | "metaKey" | "ctrlKey">> = {},
) {
  return {
    key: value,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...overrides,
  };
}

const findInFilesSource = await readFile(
  resolve(process.cwd(), "src/features/search/FindInFilesDialog.vue"),
  "utf8",
);

assert(
  "查询框有结果时回车打开当前选中项",
  getSearchKeyAction(key("Enter"), { hasResults: true, isQueryInput: true })?.type ===
    "open",
);
assert(
  "查询框有结果时上下键仍用于移动选中项",
  getSearchKeyAction(key("ArrowDown"), { hasResults: true, isQueryInput: true })?.type ===
    "move",
);
assert(
  "⌘/Ctrl+回车打开后保持搜索弹层",
  getSearchKeyAction(
    key("Enter", { metaKey: true }),
    { hasResults: true, isQueryInput: true },
  )?.keepOpen === true &&
    getSearchKeyAction(
      key("Enter", { ctrlKey: true }),
      { hasResults: true, isQueryInput: true },
    )?.keepOpen === true,
);
assert(
  "查询框无结果时回车仍执行搜索",
  getSearchKeyAction(key("Enter"), { hasResults: false, isQueryInput: true })?.type ===
    "search",
);
assert(
  "Shift+回车不触发搜索或打开",
  getSearchKeyAction(
    key("Enter", { shiftKey: true }),
    { hasResults: true, isQueryInput: true },
  ) === null,
);
assert(
  "全局搜索结果通过行引用建立可滚动定位",
  /:ref="\(element\) => setRowElement\(element, index\)"/.test(
    findInFilesSource,
  ),
);
assert(
  "全局搜索键盘移动会将当前结果滚动到可视区域",
  /scrollIntoView\(\{\s*block:\s*"nearest"\s*\}\)/s.test(
    findInFilesSource,
  ),
);

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
