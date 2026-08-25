// ==================== 终端忙/闲检测自测（node --experimental-strip-types scripts/terminal-idle-selfcheck.ts） ====================
// 验证 createPromptIdleTracker 的提示符判定：双通道（行尾特征 + 行首符号特征），
// 覆盖 bash/zsh 默认、oh-my-zsh robbyrussell 等主题，以及常见命令输出的不误判。
// 数据片段来自真实 zsh（oh-my-zsh robbyrussell）PTY 抓取。

import {
  createPromptIdleTracker,
  type PromptIdleTracker,
} from "../src/features/sessions/terminalIdle.ts";

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

/** 喂入单段数据，等待稳定窗口后返回判定（true=空闲 / false=忙碌） */
function settleIdle(data: string): Promise<boolean> {
  return new Promise((resolve) => {
    const t = createPromptIdleTracker((idle) => {
      resolve(idle);
      t.dispose();
    });
    t.feed(data);
  });
}

// 真实 zsh（robbyrussell）提示符片段：剥 ANSI 后为「➜  目录」或「➜  目录 git:(分支)」
const OMZ_PROMPT_PLAIN = "\x1b[01;32m➜  \x1b[36mtmp\x1b[00m \x1b[K";
const OMZ_PROMPT_GIT =
  "\x1b[01;32m➜  \x1b[36m~/proj\x1b[00m git:(main) \x1b[K";
const OMZ_PROMPT_GIT_DIRTY =
  "\x1b[01;32m➜  \x1b[36m~/proj\x1b[00m git:(main) \x1b[33m✗\x1b[0m\x1b[K";
// 终端真实数据：提示符前 zsh 会画反显 % 块（PROMPT_SP 部分行指示）
const OMZ_PROMPT_WITH_PERCENT_BLOCK =
  "\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m" +
  new Array(80).join(" ") +
  "\r \r\x1b]2;yanqi@MacBook-Pro:/private/tmp\x07\x1b]1;/private/tmp\x07" +
  "\x1b]7;file://MacBook-Pro.local/private/tmp\x1b\\\r\x1b[0m\x1b[27m\x1b[24m\x1b[J" +
  OMZ_PROMPT_PLAIN;

const INIT_PROMPT = "\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                               \r \r\x1b]2;yanqi@MacBook-Pro:/private/tmp\x07\x1b]1;/private/tmp\x07\x1b]7;file://MacBook-Pro.local/private/tmp\x1b\\\r\x1b[0m\x1b[27m\x1b[24m\x1b[J\x1b[01;32m➜  \x1b[36mtmp\x1b[00m \x1b[K\x1b[?1h\x1b=\x1b[?2004h";

async function main() {
  console.log("提示符识别：");
  assert(await settleIdle(OMZ_PROMPT_PLAIN), "omz 提示符➜ + 目录 → 空闲");
  assert(await settleIdle(OMZ_PROMPT_GIT), "omz 提示符➜ + git:(branch) → 空闲");
  assert(await settleIdle(OMZ_PROMPT_GIT_DIRTY), "omz 提示符➜ + git ✗ → 空闲");
  assert(await settleIdle(INIT_PROMPT), "真实初始提示符（含反显 % 块 + OSC）→ 空闲");
  assert(
    await settleIdle("\x1b[01;32myanqi@Mac\x1b[00m:\x1b[01;34m~/proj\x1b[00m$ "),
    "bash 风格 user@host:dir$ → 空闲",
  );
  assert(await settleIdle("root@host:~# "), "root 提示符 → 空闲");

  console.log("命令输出不误判：");
  assert(
    !(await settleIdle(
      "Serving HTTP on :: port 8123 (http://[::]:8123/) ...\r\n",
    )),
    "服务监听日志行 → 忙碌",
  );
  assert(
    !(await settleIdle("Keyboard interrupt received, exiting.\r\n")),
    "服务退出日志行 → 忙碌",
  );
  assert(!(await settleIdle("Building 100%...\r\n")), "含 % 的短日志行 → 忙碌");
  assert(
    !(await settleIdle(
      "[1/4] Processing file with ➜ progress indicator .................\r\n",
    )),
    "行内含 ➜ 的输出行 → 忙碌",
  );
  assert(
    !(await settleIdle(
      "%cpu  rcpu  dfree  dcpu  ifree  icpu  xfree  xcpu  mfree  mcache  mspin  qsize  mwait  pused  msize\r\n",
    )),
    "以 % 开头的长统计行（top）→ 忙碌",
  );

  assert(!(await settleIdle("progress 42%")), "无换行进度输出 42% → 忙碌");
  assert(!(await settleIdle("build >")), "无换行构建输出 build > → 忙碌");
  assert(!(await settleIdle("toolkit $")), "无换行日志 toolkit $ → 忙碌");
  assert(!(await settleIdle("42%\r52%\r62%\r72%")), "回车刷屏进度 → 忙碌");

  console.log("完整场景时序（运行中忙 → 停止后闲）：");
  const order: string[] = [];
  const t = createPromptIdleTracker((idle) =>
    order.push(idle ? "空闲" : "忙碌"),
  );
  t.feed(OMZ_PROMPT_PLAIN); // 先停在提示符
  t.feed("python3 -m http.server 8123\n");
  t.feed("\x1b]2;python3 -m http.server 8123\x07Serving HTTP on :: port 8123 ...\r\n");
  await new Promise((r) => setTimeout(r, 250));
  assert(order.at(-1) === "忙碌", "服务运行中安定后 → 忙碌", `实际: ${order.at(-1)}`);
  t.feed("^C\r\nKeyboard interrupt received, exiting.\r\n");
  t.feed(INIT_PROMPT); // shell 重新打印提示符
  await new Promise((r) => setTimeout(r, 250));
  assert(order.at(-1) === "空闲", "服务停止、提示符回归后 → 空闲", `实际: ${order.at(-1)}`);
  t.dispose();

  console.log(`\n${passed} 通过 / ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();