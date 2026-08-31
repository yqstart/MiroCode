export interface TerminalCommandReadinessProbe {
  /** PTY 当前是否可写。 */
  hasPty(): boolean;
  /** PTY 是否曾成功创建，用于区分尚未启动与已经退出。 */
  hasSpawnedPty(): boolean;
  /** 交互式 shell 是否已经输出过提示符。 */
  isShellReady(): boolean;
  /** 等待期间任务是否已经被替换或终端已经销毁。 */
  isCancelled(): boolean;
}

export type TerminalCommandReadyResult =
  "ready" | "fallback" | "cancelled" | "exited" | "timeout";

export interface TerminalCommandWaitOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
  /** 自测可注入无真实延迟的等待函数。 */
  wait?: (delayMs: number) => Promise<void>;
}

/**
 * 等到 PTY 可写且交互式 shell 已经打印提示符后再放行快捷命令。
 *
 * 仅等待 PTY 创建并不够：启动阶段把命令写进终端行规程，会先裸回显一行，
 * shell 就绪后又在提示符后重绘同一命令，形成视觉上的重复命令。
 * 若自定义提示符始终无法识别，则在等待窗口结束后降级使用仍存活的 PTY，
 * 避免非常规 shell 主题导致快捷命令完全不可用。
 */
export async function waitForTerminalCommandReady(
  probe: TerminalCommandReadinessProbe,
  options: TerminalCommandWaitOptions = {},
): Promise<TerminalCommandReadyResult> {
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? 5_000);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 50);
  const wait =
    options.wait ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let waitedMs = 0;

  while (true) {
    if (probe.isCancelled()) return "cancelled";
    if (probe.hasPty() && probe.isShellReady()) return "ready";
    if (probe.hasSpawnedPty() && !probe.hasPty()) return "exited";
    if (waitedMs >= maxWaitMs) {
      return probe.hasPty() ? "fallback" : "timeout";
    }

    const delayMs = Math.min(pollIntervalMs, maxWaitMs - waitedMs);
    await wait(delayMs);
    waitedMs += delayMs;
  }
}
