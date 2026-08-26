import { nextTick, watch, type WatchStopHandle } from "vue";
import { useEditorStore } from "@/stores/editor";
import { useSettingsStore } from "@/stores/settings";
import { useSessionsStore } from "@/stores/sessions";
import type { Window as TauriWindow } from "@tauri-apps/api/window";

/**
 * 自动保存：
 * - 开启时：内容变更后按延迟写盘
 * - 兜底：窗口隐藏 / 关闭前强制落盘（避免延迟未触发就崩溃丢改）
 */
export interface AutoSaveOptions {
  /** 关闭窗口前保存窗口级编辑器/终端快照。 */
  beforeClose?: () => void | Promise<void>;
}

export function setupAutoSave(options: AutoSaveOptions = {}): () => void {
  const settings = useSettingsStore();
  const editor = useEditorStore();
  const sessions = useSessionsStore();

  let delayTimer: number | undefined;
  let flushPromise: Promise<void> | null = null;
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
    if (!editor.hasAutoSaveableChanges()) return;
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
    if (!editor.hasAutoSaveableChanges()) return;
    clearDelay();
    const current = editor.saveAll({ quiet: true, auto: true });
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

  // Tauri 窗口关闭：先完成终端清理，再强制关闭窗口。
  // 关闭处理器必须立即返回（而不是在 close-requested 回调里 await destroy），
  // 否则 macOS 红绿灯的关闭事件可能被当前回调链消费，表现为需要再次点击。
  let closeUnlisten: (() => void) | undefined;
  let closeStarted = false;
  let allowNativeClose = false;

  async function finishWindowClose(win: TauriWindow) {
    try {
      await options.beforeClose?.();
    } catch {
      // 状态快照失败也不能跳过终端清理或阻止窗口关闭。
    }
    try {
      await sessions.closeSessions({ preserveSession: true });
      await nextTick();
    } catch {
      // 终端清理失败也不能把窗口留在半关闭状态。
    }
    try {
      await flushNow();
    } catch {
      // 自动保存失败也不能阻止窗口关闭。
    }

    // 脱离 close-requested 当前事件调用栈后再 destroy，确保本次红叉点击
    // 对应的关闭请求不会被 Tauri 的事件包装器再次拦截。
    window.setTimeout(() => {
      allowNativeClose = true;
      void win.destroy().catch(() => {
        // 极少数平台实现只接受 close；allowNativeClose 让该兜底调用
        // 触发的 close-requested 直接放行，不会重新进入清理流程。
        void win.close().catch(() => undefined);
      });
    }, 0);
  }

  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      closeUnlisten = await win.onCloseRequested((event) => {
        if (allowNativeClose) return;
        // 清理期间的重复点击只阻止重复启动清理；第一次请求对应的
        // finishWindowClose 会在完成后自动 destroy，不需要用户再次点击。
        event.preventDefault();
        if (closeStarted) return;
        closeStarted = true;
        void finishWindowClose(win);
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
