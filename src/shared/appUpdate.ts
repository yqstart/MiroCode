import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { t } from "@/i18n";
import { promptChoice } from "@/shared/choiceDialog";
import { useAppUpdateStore } from "@/stores/appUpdate";

export type CheckUpdateMode = "auto" | "manual";

export type CheckUpdateResult =
  | "updated"
  | "available"
  | "deferred"
  | "latest"
  | "skipped"
  | "error";

type NotifyFn = (message: string, ms?: number) => void;

/** Tauri Update 资源，不能放进 Pinia */
let pendingUpdate: Update | null = null;

let checking = false;
let installing = false;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 读取壳内版本号；纯 Vite 预览回退到 package 版本占位 */
export async function getAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return "0.4.0";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "0.4.0";
  }
}

function store() {
  return useAppUpdateStore();
}

/**
 * 检查 GitHub Release 上的 latest.json。
 * - auto：有更新时仅点亮右上角「更新」（不打断）
 * - manual：弹出「稍后 / 立即更新」；稍后仍保留右上角入口
 */
export async function checkForAppUpdate(
  mode: CheckUpdateMode,
  notify?: NotifyFn,
): Promise<CheckUpdateResult> {
  if (!isTauriRuntime()) {
    if (mode === "manual") notify?.(t("update.browserPreview"));
    return "skipped";
  }
  if (checking || installing) {
    if (mode === "manual") notify?.(t("update.checking"));
    return "skipped";
  }
  checking = true;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      if (pendingUpdate) {
        void pendingUpdate.close().catch(() => undefined);
        pendingUpdate = null;
      }
      store().clearAvailable();
      if (mode === "manual") notify?.(t("update.latest"));
      return "latest";
    }

    pendingUpdate = update;
    store().setAvailable(update.version, update.currentVersion);

    // 启动静默检查：只显示右上角入口
    if (mode === "auto") {
      return "available";
    }

    const notes = (update.body ?? "").trim();
    const message = notes
      ? t("update.foundMessageWithNotes", {
          version: update.version,
          current: update.currentVersion,
          notes,
        })
      : t("update.foundMessage", {
          version: update.version,
          current: update.currentVersion,
        });

    const choice = await promptChoice({
      title: t("update.foundTitle"),
      message,
      choices: [
        { id: "later", label: t("update.later"), variant: "ghost" },
        { id: "install", label: t("update.installNow"), variant: "primary" },
      ],
      dismissId: "later",
    });

    if (choice !== "install") {
      return "available";
    }

    return await installPendingUpdate(notify);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (mode === "manual") {
      notify?.(t("update.checkFailed", { message: msg }), 4200);
    } else {
      console.warn("[mirocode] 自动检查更新失败", error);
    }
    return "error";
  } finally {
    checking = false;
  }
}

/**
 * 下载并安装已发现的更新：展示进度 → 询问是否立即重启。
 * 取消则下次启动应用更新；确认则立即 relaunch。
 */
export async function installPendingUpdate(
  notify?: NotifyFn,
): Promise<CheckUpdateResult> {
  if (!isTauriRuntime()) {
    notify?.(t("update.browserPreview"));
    return "skipped";
  }
  if (!pendingUpdate) {
    notify?.(t("update.noPending"), 3200);
    return "skipped";
  }
  if (installing) {
    notify?.(t("update.downloading"), 3200);
    return "skipped";
  }

  installing = true;
  const updateStore = store();
  const update = pendingUpdate;
  try {
    updateStore.beginDownload();
    await update.downloadAndInstall((event: DownloadEvent) => {
      updateStore.onDownloadEvent(event);
    });
    updateStore.endDownload();

    const choice = await promptChoice({
      title: t("update.readyTitle"),
      message: t("update.readyMessage", { version: update.version }),
      choices: [
        { id: "later", label: t("common.cancel"), variant: "ghost" },
        { id: "now", label: t("common.ok"), variant: "primary" },
      ],
      dismissId: "later",
    });

    pendingUpdate = null;
    updateStore.clearAvailable();
    void update.close().catch(() => undefined);

    if (choice === "now") {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
      return "updated";
    }

    notify?.(t("update.willApplyOnNextLaunch"), 4800);
    return "deferred";
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    notify?.(t("update.installFailed", { message: msg }), 4800);
    return "error";
  } finally {
    updateStore.endDownload();
    installing = false;
  }
}
