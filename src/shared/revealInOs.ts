import { t } from "@/i18n";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 在系统文件管理器中显示并选中路径（macOS Finder / Windows 资源管理器 / Linux 文件管理器）。
 */
export async function revealInOsExplorer(
  path: string,
  notify?: (message: string, ms?: number) => void,
): Promise<boolean> {
  if (!path) {
    notify?.(t("notice.noPathToReveal"), 2800);
    return false;
  }
  if (!isTauriRuntime()) {
    notify?.(t("explorer.revealInOsUnavailable"), 3200);
    return false;
  }
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    notify?.(t("explorer.revealInOsFailed", { message: msg }), 4200);
    return false;
  }
}
