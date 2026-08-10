/**
 * 流式补全过滤管道
 *
 * 参考 Continue streamTransforms：
 * 1. 行级稳定更新（lineStream）：只在检测到完整换行时才 flush，避免 ghost text
 *    逐 token 重绘导致的光标抖动；未完成的行保留在 buffer。
 * 2. showWhateverWeHaveAtXMs：流式开始后 300ms 若 buffer 有内容且仍无换行，
 *    也强制 flush（保证首行尽快可见，不等整行生成完）。
 */

/** 默认首字提示延迟（毫秒） */
export const SHOW_WHATEVER_MS = 300;

export class StreamFilter {
  /** 未完成行的累积 buffer */
  private buffer = "";
  /** 流式开始时间（首 token 到达） */
  private startTime = 0;
  /** showWhateverWeHaveAtXMs 定时器 */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已 flush 的完整文本（供 onDone 兜底） */
  private flushed = "";

  constructor(
    /** 每行 flush 时回调（收到完整行文本） */
    private onLine: (line: string) => void,
    /** 超时强制显示时回调（收到当前 buffer 内容） */
    private onPartial: (partial: string) => void,
    /** 首字提示延迟（毫秒） */
    private showWhateverMs = SHOW_WHATEVER_MS,
  ) {}

  /** 流式开始（首 token 到达时调用） */
  start(): void {
    this.startTime = Date.now();
  }

  /** 接收增量文本 */
  push(text: string): void {
    this.buffer += text;

    // 每到一个换行符，flush 完整行
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl === -1) break;
      const line = this.buffer.slice(0, nl + 1); // 含换行符，widget 需保留换行渲染
      this.buffer = this.buffer.slice(nl + 1);
      this.flushed += line;
      this.onLine(line);
    }

    // 首字提示：开始 300ms 后 buffer 仍无换行，强制显示当前内容
    if (this.buffer && !this.flushTimer) {
      const elapsed = Date.now() - this.startTime;
      const delay = Math.max(0, this.showWhateverMs - elapsed);
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (this.buffer) {
          this.onPartial(this.buffer);
        }
      }, delay);
    }
  }

  /** 流式结束：flush 剩余 buffer（未完成的最后一行也显示） */
  finish(): string {
    this.clearTimer();
    const rest = this.buffer;
    this.buffer = "";
    if (rest) {
      this.flushed += rest;
      this.onLine(rest);
    }
    return this.flushed;
  }

  /** 取消：清定时器，丢弃 buffer（调用方自行处理已 flush 内容） */
  cancel(): void {
    this.clearTimer();
    this.buffer = "";
  }

  /** 当前应展示的完整文本（flushed 完整行 + 未完成的 buffer 行） */
  displayText(): string {
    return this.flushed + this.buffer;
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
