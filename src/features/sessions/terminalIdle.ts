/**
 * 本地终端空闲检测：解析 PTY 输出流，判断 shell 是否停在提示符上（无前台任务）。
 *
 * 原理：shell 空闲时输出流末尾是提示符（prompt 通常无行尾换行，光标停在其后）；
 * 命令运行时输出的是命令产物，末尾不再出现提示符，直到命令结束 shell 重新打印
 * 提示符。对输出流做行切分（含无行尾的残余段），剥除 ANSI 转义后按行尾特征判定，
 * 并加一个稳定窗口：只有该判定在 N 毫秒内未被新输出推翻才上报空闲。
 * 启发式有误判空间（命令输出行恰以 $ / > 等结尾），误判后果仅是快捷方式多开或
 * 复用终端，不影响正确性；核心场景（dev server 等常驻任务）输出不匹配提示符特征。
 */

/** 提示符行尾特征：剥除 ANSI 后以这些字符之一结尾（后跟可选空白）。
 *  $ % bash/zsh/csh 默认；# root；> 续行提示符/Windows；❯ » oh-my-zsh 常见主题 */
const PROMPT_TAIL = /[$%#>❯»]\s*$/;

/** 提示符行长度上限：命令输出行远长于常规提示符，长度约束过滤大部分误判 */
const PROMPT_MAX_LEN = 300;

/** 剥除 CSI（ESC [ … 终字节）与 OSC（ESC ] … BEL/ST）转义序列 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isPromptLine(line: string): boolean {
  const clean = stripAnsi(line);
  if (!clean || clean.length > PROMPT_MAX_LEN) return false;
  return PROMPT_TAIL.test(clean);
}

export interface PromptIdleTracker {
  feed(data: string): void;
  dispose(): void;
}

/**
 * 创建提示符空闲检测器。feed 喂入 PTY 输出 chunk；判定稳定（settleMs 内无新输出）
 * 后回调 onIdleChange(true=空闲 / false=忙碌)。
 */
export function createPromptIdleTracker(
  onIdleChange: (idle: boolean) => void,
  settleMs = 150,
): PromptIdleTracker {
  let buffer = "";
  let lastTailIsPrompt = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function settle() {
    timer = null;
    if (disposed) return;
    onIdleChange(lastTailIsPrompt);
  }

  function restartTimer() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(settle, settleMs);
  }

  function feed(data: string) {
    if (disposed) return;
    buffer += data;
    // 行切分：\r\n 优先视为一个换行；残余段（提示符本身无行尾）也参与判定
    let found = true;
    while (found) {
      found = false;
      const nl = buffer.indexOf("\n");
      const cr = buffer.indexOf("\r");
      let idx = -1;
      if (nl >= 0 && (cr < 0 || nl < cr)) idx = nl;
      else if (cr >= 0) idx = cr;
      if (idx < 0) break;
      const line = buffer.slice(0, idx);
      // \r\n 连体只切一次
      const skip = buffer[idx] === "\r" && buffer[idx + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(idx + skip);
      // 空行（连续换行）不推翻既有判定
      if (line.length > 0) lastTailIsPrompt = isPromptLine(line);
      found = true;
    }
    if (buffer.length > 0) {
      lastTailIsPrompt = isPromptLine(buffer);
    }
    restartTimer();
  }

  function dispose() {
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { feed, dispose };
}
