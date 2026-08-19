import { nextTick, watch, type WatchStopHandle } from "vue";
import { useEditorStore } from "@/stores/editor";
import { useSettingsStore } from "@/stores/settings";
import { useSessionsStore } from "@/stores/sessions";

/**
 * 自动保存：
 * - 开启时：内容变更后按延迟写盘
 * - 兜底：窗口隐藏 / 关闭前强制落盘（避免延迟未触发就崩溃丢改）
 */
export function setupAutoSave(): () => void {
  const settings = useSettingsStore();
  const editor = useEditorStore();
  const sessions = useSessionsStore();

  let delayTimer: number | undefined;
  let flushPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  const stops: WatchStopHandle[] = [];
  const cleanups: Array<() => void> = [];

  function clearDelay() {
    if (delayTimer !== undefined) {
      window.clearTimeout(delayTimer);
      delayTimer = undefined;
    }
  }

  function scheduleDelayedSave() {
    if (!settings.editor.autoSave) return;
    if (!editor.dirtyPaths.size) return;
    clearDelay();
    const delay = Math.max(200, settings.editor.autoSaveDelayMs || 1000);
    delayTimer = window.setTimeout(() => {
      delayTimer = undefined;
      void flushNow();
    }, delay);
  }

  async function flushNow() {
    if (flushPromise) {
      await flushPromise;
      return;
    }
    if (!settings.editor.autoSave) return;
    if (!editor.dirtyPaths.size) return;
    clearDelay();
    const current = editor.saveAll({ quiet: true });
    flushPromise = current;
    try {
      await current;
    } finally {
      if (flushPromise === current) {
        flushPromise = null;
      }
    }
  }

  stops.push(
    watch(
      // dirtyPaths 的 Set 引用只在脏标签集合实际变化时替换（editor.ts 缓存），
      // 连续输入不触发；比「tabs 拼接脏标记字符串」省去每键 O(tab 数) 构建
      () => editor.dirtyPaths,
      () => scheduleDelayedSave(),
    ),
  );

  stops.push(
    watch(
      () => [settings.editor.autoSave, settings.editor.autoSaveDelayMs] as const,
      () => {
        clearDelay();
        if (settings.editor.autoSave) scheduleDelayedSave();
      },
    ),
  );

  function onVisibility() {
    if (document.visibilityState === "hidden") {
      void flushNow();
    }
  }

  function onPageHide() {
    void flushNow();
  }

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  cleanups.push(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  });

  // Tauri 窗口关闭：先落盘再销毁，作为崩溃/退出兜底
  let closeUnlisten: (() => void) | undefined;
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      closeUnlisten = await win.onCloseRequested(async (event) => {
        event.preventDefault();
        // macOS 红点关闭可能在清理期间重复触发；复用同一个 Promise，
        // 避免多个 close handler 同时保存、销毁同一个窗口。
        if (closePromise) return;
        closePromise = (async () => {
          // 先卸载本窗口的终端组件，让 PTY kill 尽早发出；常驻终端不能
          // 继续占用运行时线程，否则保存和 destroy 也会被拖住。
          await sessions.closeSessions();
          await nextTick();
          await flushNow();
          closeUnlisten?.();
          closeUnlisten = undefined;
          await win.destroy();
        })();
        try {
          await closePromise;
        } finally {
          closePromise = null;
        }
      });
    } catch {
      // 纯浏览器预览无 Tauri
    }
  })();

  return () => {
    clearDelay();
    for (const stop of stops) stop();
    for (const fn of cleanups) fn();
    closeUnlisten?.();
  };
}
