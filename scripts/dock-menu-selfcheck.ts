import { dispatchDockMenuEvent } from "../src/shared/dockMenu.ts";

let failed = 0;
function assert(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const calls: string[] = [];
const handlers = {
  openFolder: () => calls.push("current"),
  openRecentInNewWindow: (path: string) => calls.push(`new:${path}`),
};

dispatchDockMenuEvent({ id: "recent", path: "/workspace/recent-project" }, handlers);
assert(
  "Dock 最近项目走新窗口处理器",
  JSON.stringify(calls) === JSON.stringify(["new:/workspace/recent-project"]),
  calls,
);

calls.length = 0;
dispatchDockMenuEvent({ id: "open_folder" }, handlers);
assert("Dock 打开文件夹仍走当前窗口处理器", calls[0] === "current", calls);

calls.length = 0;
dispatchDockMenuEvent({ id: "recent" }, handlers);
assert("缺少项目路径时不执行打开", calls.length === 0, calls);

console.log(`\n通过 ${3 - failed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
