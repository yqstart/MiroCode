/**
 * 本地终端空闲检测：解析 PTY 输出流，判断 shell 是否停在提示符上（无前台任务）。
 *
 * 原理：shell 空闲时输出流末尾是提示符（prompt 通常无行尾换行，光标停在其后）；
 * 命令运行时输出的是命令产物，末尾不再出现提示符，直到命令结束 shell 重新打印
 * 提示符。对输出流做行切分（含无行尾的残余段），剥除 ANSI 转义后判定，并加一个
 * 稳定窗口：只有该判定在 N 毫秒内未被新输出推翻才上报空闲。
 * 判定双通道：① 行尾特征——传统提示符以 $ % # > ❯ » 收尾；② 行首符号特征——
 * oh-my-zsh 等主题提示符以符号开头、目录/git 状态收尾（robbyrussell「➜  ~ git:(main)」
 * 等），行首为提示符符号且行短即命中。启发式有误判空间（命令输出行恰以符号开头且短），
 * 误判后果仅是快捷方式多开或复用终端，不影响正确性；核心场景（dev server 等常驻
 * 任务）输出行既不以符号收尾、也不以符号开头，判定为忙碌。
 */

/** 传统提示符的上下文形态：避免把任意输出行尾的 `$`/`%`/`>` 当成提示符。
 * 覆盖 user@host:dir$、~/project%、bash-3.2$、PS C:\\> 与裸 `$`/`#`/`>`。
 * 单独的 `progress 42%`、`build >`、`toolkit $` 不满足上下文。 */
const PROMPT_CONTEXT = /^(?:[$#%>]\s*|[^ \t]+@[^ \t]+(?::\S*)?[$#%>]\s*|(?:bash|zsh|sh|fish)(?:-[\d.]+)?[$#%>]\s*|PS(?:\s+\S+)*[$#%>]\s*|.*(?:[~/:\\])\S*[$#%>]\s*)$/;

/** 提示符符号：仅当位于行首时视作提示符行（提示符的符号恒在开头，如 omz 主题
 *  行首的 ➜ / ❯ / »；✗ ✓ 较少见但同样只出现在部分主题的行首）。❯ » ➜ 为 omz
 *  常见主题箭头（robbyrussell 用 ➜ U+279C，不在 PROMPT_TAIL 内）。
 *  不用「行内任意位置」：日志行内嵌 % / > / ➜ 极为常见，会大面积误判。 */
const PROMPT_SYMBOL_LEADING = /^[$%#>❯»➜✗✓]/;

/** 符号特征的行长度上限：robbyrussell 带长 git 分支与目录约 60 字符，此处留余量；
 *  长度约束过滤长日志输出行（如 top 的 %cpu 行、进度条行）的误判。 */
const PROMPT_SYMBOL_MAX_LEN = 80;

/** 提示符行长度上限：命令输出行远长于常规提示符，长度约束过滤大部分误判 */
const PROMPT_MAX_LEN = 300;

/** 剥除 CSI（ESC [ … 终字节）与 OSC（ESC ] … BEL/ST）转义序列 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isPromptLine(line: string): boolean {
  // \r 是 PTY 输出普遍存在的行重置符（提示符重画前回行首），不属于提示符内容，
  // 剔除后符号检测才不因前导 \r 失位。
  const clean = stripAnsi(line).replace(/\r/g, "");
  if (!clean || clean.length > PROMPT_MAX_LEN) return false;
  if (PROMPT_CONTEXT.test(clean)) return true;
  if (clean.length <= PROMPT_SYMBOL_MAX_LEN && PROMPT_SYMBOL_LEADING.test(clean)) return true;
  return false;
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
