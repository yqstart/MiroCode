// ==================== 终端命令标题自测 ====================

import {
  createTerminalCommandTracker,
  summarizeTerminalCommand,
} from "../src/shared/terminalCommand.ts";

let failed = 0;
let passed = 0;

function assert(ok: boolean, name: string, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`);
  }
}

const commands: string[] = [];
const tracker = createTerminalCommandTracker((command) => commands.push(command));

tracker.feed("pnpm run dev\r");
assert(commands.at(-1) === "pnpm run dev", "回车提交普通命令");

tracker.feed("git stt\x7fatus\r");
assert(commands.at(-1) === "git status", "退格后提交编辑中的命令");

tracker.feed("npm test\r");
tracker.feed("\x1b[A\r");
assert(commands.at(-1) === "npm test", "方向键上翻并重新执行历史命令");

const beforeCancel = commands.length;
tracker.feed("unfinished\x03");
tracker.feed("\r");
assert(commands.length === beforeCancel, "Ctrl+C 取消未提交输入");

const longTitle = summarizeTerminalCommand(
  "pnpm run build --filter @mirocode/editor --reporter append-only",
);
assert(longTitle.length === 32 && longTitle.endsWith("…"), "超长命令压缩为固定长度标题");

tracker.dispose();

console.log(`\n${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
