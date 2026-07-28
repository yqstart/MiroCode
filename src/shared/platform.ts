/** 当前是否为 macOS（含 iOS 桌面 WebView 兜底） */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = (uaData || navigator.platform || navigator.userAgent || "").toLowerCase();
  return (
    platform.includes("mac") ||
    platform.includes("iphone") ||
    platform.includes("ipad") ||
    platform.includes("ipod")
  );
}

/**
 * 将快捷键按当前系统格式化为可读文案。
 * 修饰键用 "mod" / "alt" / "shift"；其余为按键名（如 "O"、"Enter"、"`"、"F1"）。
 * macOS：⌘⇧F；Windows/Linux：Ctrl+Shift+F
 */
export function formatShortcut(...keys: Array<"mod" | "alt" | "shift" | string>): string {
  const mac = isMacOS();
  const parts = keys.map((key) => {
    if (key === "mod") return mac ? "⌘" : "Ctrl";
    if (key === "alt") return mac ? "⌥" : "Alt";
    if (key === "shift") return mac ? "⇧" : "Shift";
    return key;
  });
  return mac ? parts.join("") : parts.join("+");
}
