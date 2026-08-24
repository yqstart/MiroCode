/** 本地终端命令标题：把当前 shell 输入转换成适合标签展示的短文本。 */

const MAX_TERMINAL_TITLE_LENGTH = 32;
const MAX_HISTORY_LENGTH = 50;

function compactWhitespace(value: string): string {
  return value.replace(/[\r\n\t ]+/g, " ").trim();
}

/** 将命令压缩为终端标签标题，避免超长命令撑开底部标签栏。 */
export function summarizeTerminalCommand(command: string): string {
  const normalized = compactWhitespace(command);
  if (normalized.length <= MAX_TERMINAL_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TERMINAL_TITLE_LENGTH - 1)}…`;
}

export interface TerminalCommandTracker {
  /** 接收已经确认要写入 PTY 的键盘数据。 */
  feed(data: string): void;
  /** 清空未提交的 shell 输入。 */
  reset(): void;
  dispose(): void;
}

type SubmitCommand = (command: string) => void;

/**
 * 轻量 shell 输入跟踪器：只追踪普通 shell 的当前输入行，回车时上报命令。
 *
 * 不解析终端输出，也不试图模拟 shell 语法；它只处理常见的输入编辑键，
 * 足够覆盖手动输入、历史命令、粘贴命令和 package scripts 注入场景。
 */
export function createTerminalCommandTracker(
  onSubmit: SubmitCommand,
): TerminalCommandTracker {
  let line: string[] = [];
  let cursor = 0;
  let history: string[] = [];
  let historyIndex = 0;
  let pendingEscape = "";
  let disposed = false;

  function currentLine(): string {
    return line.join("");
  }

  function setLine(value: string): void {
    line = Array.from(value);
    cursor = line.length;
  }

  function markEdited(): void {
    historyIndex = history.length;
  }

  function insert(value: string): void {
    const chars = Array.from(value);
    if (!chars.length) return;
    line.splice(cursor, 0, ...chars);
    cursor += chars.length;
    markEdited();
  }

  function backspace(): void {
    if (cursor <= 0) return;
    line.splice(cursor - 1, 1);
    cursor -= 1;
    markEdited();
  }

  function deleteForward(): void {
    if (cursor >= line.length) return;
    line.splice(cursor, 1);
    markEdited();
  }

  function removePreviousWord(): void {
    while (cursor > 0 && /\s/.test(line[cursor - 1])) {
      line.splice(cursor - 1, 1);
      cursor -= 1;
    }
    while (cursor > 0 && !/\s/.test(line[cursor - 1])) {
      line.splice(cursor - 1, 1);
      cursor -= 1;
    }
    markEdited();
  }

  function submit(): void {
    const command = currentLine().trim();
    if (command) {
      history = [...history, command].slice(-MAX_HISTORY_LENGTH);
      onSubmit(command);
    }
    line = [];
    cursor = 0;
    historyIndex = history.length;
  }

  function selectHistory(direction: -1 | 1): void {
    if (!history.length) return;
    if (historyIndex === history.length) {
      historyIndex = direction < 0 ? history.length - 1 : history.length;
    } else {
      historyIndex = Math.max(
        0,
        Math.min(history.length, historyIndex + direction),
      );
    }
    setLine(history[historyIndex] ?? "");
  }

  function consumeEscapeSequence(sequence: string): void {
    if (sequence === "\x1b[A" || sequence === "\x1bOA") {
      selectHistory(-1);
      return;
    }
    if (sequence === "\x1b[B" || sequence === "\x1bOB") {
      selectHistory(1);
      return;
    }
    if (sequence === "\x1b[D" || sequence === "\x1bOD") {
      cursor = Math.max(0, cursor - 1);
      return;
    }
    if (sequence === "\x1b[C" || sequence === "\x1bOC") {
      cursor = Math.min(line.length, cursor + 1);
      return;
    }
    if (sequence === "\x1b[H" || sequence === "\x1b[1~") {
      cursor = 0;
      return;
    }
    if (sequence === "\x1b[F" || sequence === "\x1b[4~") {
      cursor = line.length;
      return;
    }
    if (sequence === "\x1b[3~") {
      deleteForward();
    }
  }

  function parseEscapeSequence(value: string): string | null {
    if (value.length < 2) return null;
    if (value[1] !== "[") {
      if (value[1] === "O") {
        return value.length >= 3 ? value.slice(0, 3) : null;
      }
      // Alt+B / Alt+F：按单词移动；其他两字节转义键忽略。
      if (value[1] === "b") {
        while (cursor > 0 && /\s/.test(line[cursor - 1])) cursor -= 1;
        while (cursor > 0 && !/\s/.test(line[cursor - 1])) cursor -= 1;
      } else if (value[1] === "f") {
        while (cursor < line.length && /\s/.test(line[cursor])) cursor += 1;
        while (cursor < line.length && !/\s/.test(line[cursor])) cursor += 1;
      }
      return value.slice(0, 2);
    }
    const match = value.match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
    return match ? match[0] : null;
  }

  function feed(data: string): void {
    if (disposed || !data) return;
    pendingEscape += data;
    let offset = 0;

    while (offset < pendingEscape.length) {
      const char = pendingEscape[offset];
      if (char === "\x1b") {
        const sequence = parseEscapeSequence(pendingEscape.slice(offset));
        if (!sequence) break;
        consumeEscapeSequence(sequence);
        offset += sequence.length;
        continue;
      }

      offset += 1;
      switch (char) {
        case "\r":
        case "\n":
          submit();
          break;
        case "\x03":
          // Ctrl+C：取消当前输入，不覆盖已经执行过的命令标题。
          line = [];
          cursor = 0;
          historyIndex = history.length;
          break;
        case "\x08":
        case "\x7f":
          backspace();
          break;
        case "\x15":
          line = [];
          cursor = 0;
          markEdited();
          break;
        case "\x17":
          removePreviousWord();
          break;
        case "\x01":
          cursor = 0;
          break;
        case "\x05":
          cursor = line.length;
          break;
        case "\x02":
          cursor = Math.max(0, cursor - 1);
          break;
        case "\x06":
          cursor = Math.min(line.length, cursor + 1);
          break;
        case "\x0b":
          line = line.slice(0, cursor);
          markEdited();
          break;
        case "\t":
          // Tab 可能触发 shell 补全，补全结果会由 shell 回显；这里不猜测文本。
          break;
        default:
          if (char >= " " && char !== "\x7f") insert(char);
      }
    }

    pendingEscape = pendingEscape.slice(offset);
  }

  function reset(): void {
    line = [];
    cursor = 0;
    historyIndex = history.length;
    pendingEscape = "";
  }

  function dispose(): void {
    disposed = true;
    reset();
    history = [];
  }

  return { feed, reset, dispose };
}
