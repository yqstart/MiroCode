import { WebLinksAddon } from "@xterm/addon-web-links";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 终端链接 addon：⌘（mac）/ Ctrl（其他平台）+ 点击在默认浏览器打开链接，
 * 对标 VS Code / Cursor 集成终端。普通点击不动作——终端输出里的 URL
 * 常被选中复制，直接单击打开会误触。
 *
 * Tauri 运行时走 opener 插件（系统级打开，WKWebView 内 window.open 不可靠），
 * 纯 Vite 预览等无 Tauri runtime 时回退 window.open。
 */
export function createTerminalLinksAddon(): WebLinksAddon {
  return new WebLinksAddon((event, uri) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    void openTerminalLink(uri);
  });
}

async function openTerminalLink(uri: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(uri);
      return;
    } catch {
      // opener 打开失败（无默认浏览器等）：回退 window.open 尽力而为
    }
  }
  window.open(uri, "_blank", "noopener");
}