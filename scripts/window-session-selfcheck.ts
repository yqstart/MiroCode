import {
  getWindowSessionId,
  loadWindowSessions,
  removeWindowSession,
  saveWindowSession,
} from "../src/shared/windowSession.ts";
import {
  loadEditorSession,
  saveEditorSession,
} from "../src/shared/editorSession.ts";
import {
  loadTerminalSession,
  saveTerminalSession,
} from "../src/shared/terminalSession.ts";

type Stored = Map<string, string>;
const stored: Stored = new Map();
(globalThis as typeof globalThis & {
  localStorage: Storage;
  window: { location: { search: string } };
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
(globalThis as typeof globalThis & {
  window: { location: { search: string } };
}).window = { location: { search: "?windowId=window-a" } };

let failed = 0;
function assert(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const root = "/workspace/demo";
const fileA = "/workspace/demo/src/a.ts";
const fileB = "/workspace/demo/src/b.ts";

assert("从 URL 读取稳定窗口 ID", getWindowSessionId() === "window-a");
saveWindowSession(root, "window-a");
saveWindowSession("/workspace/other", "window-b");
assert("多个窗口记录并存", loadWindowSessions().length === 2, loadWindowSessions());
removeWindowSession("window-b");
assert(
  "关闭窗口后只移除对应窗口记录",
  loadWindowSessions().length === 1 && loadWindowSessions()[0]?.id === "window-a",
);

saveEditorSession(root, {
  tabs: [
    {
      path: fileA,
      cursor: { line: 3, column: 2 },
      pinned: true,
    },
  ],
  activePath: fileA,
}, "window-a");
saveEditorSession(root, {
  tabs: [
    {
      path: fileB,
      cursor: { line: 8, column: 1 },
      pinned: false,
    },
  ],
  activePath: fileB,
}, "window-b");
assert(
  "同一工作区的编辑器会话按窗口隔离",
  loadEditorSession(root, "window-a")?.activePath === fileA &&
    loadEditorSession(root, "window-b")?.activePath === fileB,
);

saveTerminalSession(
  root,
  {
    localTerminals: [{ id: "local-1", title: "终端 1", cwd: root }],
    activeLocalId: "local-1",
    open: true,
    dormant: false,
  },
  "window-a",
);
saveTerminalSession(
  root,
  {
    localTerminals: [
      { id: "local-1", title: "终端 1", cwd: "/workspace/other" },
      { id: "local-2", title: "终端 2", cwd: "/workspace/other" },
    ],
    activeLocalId: "local-2",
    open: false,
    dormant: true,
  },
  "window-b",
);
assert(
  "终端标签和展开状态按窗口隔离",
  loadTerminalSession(root, "window-a")?.localTerminals.length === 1 &&
    loadTerminalSession(root, "window-a")?.open === true &&
    loadTerminalSession(root, "window-b")?.localTerminals.length === 2 &&
    loadTerminalSession(root, "window-b")?.activeLocalId === "local-2" &&
    loadTerminalSession(root, "window-b")?.dormant === true,
);

console.log(`\n通过 ${5 - failed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
