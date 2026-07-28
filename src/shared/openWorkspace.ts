import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { basename } from "@/shared/fs";

/** 从启动 URL 读取新窗口要打开的文件夹 */
export function readBootFolder(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const folder = params.get("folder");
    return folder?.trim() ? folder : null;
  } catch {
    return null;
  }
}

/** 在新窗口中打开指定文件夹 */
export async function openFolderInNewWindow(folder: string): Promise<void> {
  const label = `proj-${Date.now()}`;
  const url = `index.html?folder=${encodeURIComponent(folder)}`;
  const webview = new WebviewWindow(label, {
    title: `Miro Code — ${basename(folder)}`,
    url,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    focus: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    trafficLightPosition: new LogicalPosition(14, 12),
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once("tauri://created", () => resolve());
    void webview.once("tauri://error", (event) => {
      reject(new Error(String(event.payload ?? "创建新窗口失败")));
    });
  });
}
