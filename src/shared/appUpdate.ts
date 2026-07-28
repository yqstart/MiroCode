import { promptChoice } from "@/shared/choiceDialog";

export type CheckUpdateMode = "auto" | "manual";

let checking = false;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 读取壳内版本号；纯 Vite 预览回退到构建占位 */
export async function getAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return "0.1.1";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "0.1.1";
  }
}

/**
 * 检查 GitHub Release 上的 latest.json；有新版本时弹窗确认后下载安装并重启。
 * @returns 是否发现并处理了更新（含用户点「稍后」）
 */
export async function checkForAppUpdate(
  mode: CheckUpdateMode,
  notify?: (message: string, ms?: number) => void,
): Promise<"updated" | "available" | "latest" | "skipped" | "error"> {
  if (!isTauriRuntime()) {
    if (mode === "manual") notify?.("当前为浏览器预览，无法检查更新");
    return "skipped";
  }
  if (checking) {
    if (mode === "manual") notify?.("正在检查更新…");
    return "skipped";
  }
  checking = true;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      if (mode === "manual") notify?.("已是最新版本");
      return "latest";
    }

    const notes = (update.body ?? "").trim();
    const message = notes
      ? `发现新版本 ${update.version}（当前 ${update.currentVersion}）\n\n${notes}`
      : `发现新版本 ${update.version}（当前 ${update.currentVersion}）。是否立即下载并安装？`;

    const choice = await promptChoice({
      title: "发现新版本",
      message,
      choices: [
        { id: "later", label: "稍后", variant: "ghost" },
        { id: "install", label: "立即更新", variant: "primary" },
      ],
      dismissId: "later",
    });

    if (choice !== "install") {
      return "available";
    }

    notify?.("正在下载更新…", 6000);
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return "updated";
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 自动检查失败时静默（网络/未发布 latest.json 属常见）；手动检查给出反馈
    if (mode === "manual") {
      notify?.(`检查更新失败：${msg}`, 4200);
    } else {
      console.warn("[mirocode] 自动检查更新失败", error);
    }
    return "error";
  } finally {
    checking = false;
  }
}
