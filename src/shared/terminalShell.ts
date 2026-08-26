/** 本地终端默认 shell 判定（按平台）：启动 PTY 与终端标签命名共用。 */

/** 返回 shell 可执行文件路径（与 tauri-pty spawn 参数对应） */
export function defaultShellPath(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "powershell.exe";
  if (platform.includes("mac")) return "/bin/zsh";
  return "/bin/bash";
}

/** 返回 shell 显示名（终端标签标题：zsh / bash / powershell） */
export function defaultShellName(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "powershell";
  if (platform.includes("mac")) return "zsh";
  return "bash";
}

/** 从历史快照的 title 推断 shell 名（旧快照可能是「终端 N」或命令摘要） */
export function inferShellFromTitle(title: string): string {
  const match = /^(zsh|bash|powershell)(?: \(\d+\))?$/.exec(title);
  return match ? match[1] : defaultShellName();
}
