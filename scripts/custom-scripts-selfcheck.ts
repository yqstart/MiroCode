// ==================== 自定义脚本持久化自测 ====================

import {
  loadCustomScriptsForRoot,
  setCustomScriptsForRoot,
} from "../src/shared/customScripts.ts";

const stored = new Map<string, string>();
(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
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

const rootA = "/workspace/project-a";
const rootB = "/workspace/project-b";

setCustomScriptsForRoot(rootA, [
  { name: "  start-api ", script: "  pnpm --filter api dev  " },
  { name: "invalid", script: "" },
  { name: "start-api", script: "duplicate" },
]);

assert(
  "保存后可按工作区恢复自定义指令",
  JSON.stringify(loadCustomScriptsForRoot(rootA)) ===
    JSON.stringify([{ name: "start-api", script: "pnpm --filter api dev" }]),
  loadCustomScriptsForRoot(rootA),
);
assert("不同工作区互不串数据", loadCustomScriptsForRoot(rootB).length === 0);

setCustomScriptsForRoot(rootA, []);
assert("删除后持久化为空", loadCustomScriptsForRoot(rootA).length === 0);

console.log(`\n通过 ${3 - failed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
