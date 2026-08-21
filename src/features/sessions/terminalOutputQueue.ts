/**
 * 终端输出节流队列。
 *
 * PTY 的输出可能远高于 WebView 每帧的渲染能力。逐 chunk 调用
 * xterm.write 会让解析、布局和 DOM 绘制与 Vue 主界面争抢同一条线程，
 * 最终表现为资源树和编辑器一起“消失”。队列按固定节奏、固定预算刷出，
 * 并对极端日志流保留最新尾部，避免内存无界增长。
 */
export interface TerminalOutputQueueOptions {
  /** 两次刷新之间的最短间隔。默认约 60fps。 */
  flushDelayMs?: number;
  /** 单次交给 xterm 的最大字符数。 */
  maxChunkChars?: number;
  /** 队列允许保留的最大字符数，超出时丢弃旧日志。 */
  maxBufferedChars?: number;
}

export interface TerminalOutputQueue {
  push(data: string): void;
  dispose(): void;
}

const DROPPED_OUTPUT_NOTICE =
  "\r\n\x1b[90m[终端输出过快，已省略部分旧日志]\x1b[0m\r\n";

export function createTerminalOutputQueue(
  write: (data: string) => void,
  options: TerminalOutputQueueOptions = {},
): TerminalOutputQueue {
  const flushDelayMs = Math.max(8, options.flushDelayMs ?? 16);
  const maxChunkChars = Math.max(1024, options.maxChunkChars ?? 32 * 1024);
  const maxBufferedChars = Math.max(
    maxChunkChars,
    options.maxBufferedChars ?? 256 * 1024,
  );

  let pending = "";
  let dropped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function schedule(): void {
    if (disposed || timer !== null) return;
    timer = setTimeout(flush, flushDelayMs);
  }

  function flush(): void {
    timer = null;
    if (disposed) return;

    const chunk = pending.slice(0, maxChunkChars);
    pending = pending.slice(chunk.length);
    if (dropped) {
      dropped = false;
      try {
        write(DROPPED_OUTPUT_NOTICE);
      } catch {
        // 终端组件正在销毁时，丢弃本次输出即可。
      }
    }
    if (chunk) {
      try {
        write(chunk);
      } catch {
        // 终端组件正在销毁时，丢弃本次输出即可。
      }
    }
    if (pending || dropped) schedule();
  }

  function push(data: string): void {
    if (disposed || !data) return;
    pending += data;
    if (pending.length > maxBufferedChars) {
      pending = pending.slice(-maxBufferedChars);
      dropped = true;
    }
    schedule();
  }

  function dispose(): void {
    disposed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = "";
    dropped = false;
  }

  return { push, dispose };
}
