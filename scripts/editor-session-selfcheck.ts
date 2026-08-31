import { loadEditorSession, saveEditorSession } from "../src/shared/editorSession.ts";

type Stored = Map<string, string>;
const stored: Stored = new Map();
(globalThis as typeof globalThis & {
  localStorage: Storage;
}).localStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
  clear: () => stored.clear(),
  key: (index: number) => [...stored.keys()][index] ?? null,
  get length() {
    return stored.size;
  },
} as Storage;

let failed = 0;
function assert(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const root = "/workspace/demo";
const file = "/workspace/demo/src/main.ts";

saveEditorSession(root, {
  tabs: [
    {
      path: file,
      cursor: { line: 12, column: 4 },
      pinned: true,
      dirty: true,
      content: "const value = 2",
      original: "const value = 1",
    },
    {
      path: "/workspace/demo/README.md",
      cursor: { line: 2, column: 1 },
      pinned: false,
    },
  ],
  activePath: file,
  recentPaths: [file, "/workspace/demo/src/closed.ts"],
});

const loaded = loadEditorSession(root);
assert("按工作区读取会话", loaded !== null);
assert("恢复活动文件", loaded?.activePath === file, loaded);
assert("恢复光标和固定状态", loaded?.tabs[0]?.cursor.line === 12 && loaded.tabs[0].pinned === true, loaded);
assert("恢复未保存快照", loaded?.tabs[0]?.dirty === true && loaded.tabs[0].content === "const value = 2", loaded);
assert("过滤工作区外路径", loadEditorSession(root)!.tabs.every((tab) => tab.path.startsWith(root)), loaded);
assert(
  "恢复最近文件（含已关闭文件）",
  loaded?.recentPaths?.[1] === "/workspace/demo/src/closed.ts",
  loaded,
);

console.log(`\n通过 ${6 - failed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
