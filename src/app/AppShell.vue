<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { storeToRefs } from "pinia";
import { listen } from "@tauri-apps/api/event";
import ActivityBar from "@/app/ActivityBar.vue";
import SideBar from "@/app/SideBar.vue";
import TitleBar from "@/app/TitleBar.vue";
import UpdateBadge from "@/app/UpdateBadge.vue";
import EditorArea from "@/app/EditorArea.vue";
import StatusBar from "@/app/StatusBar.vue";
import FindInFilesDialog from "@/features/search/FindInFilesDialog.vue";
import QuickOpen from "@/features/search/QuickOpen.vue";
import TerminalPanel from "@/features/sessions/TerminalPanel.vue";
import SettingsModal from "@/features/settings/SettingsModal.vue";
import ChoiceDialog from "@/shared/ChoiceDialog.vue";
import GitAuthDialog from "@/shared/GitAuthDialog.vue";
import PromptDialog from "@/shared/PromptDialog.vue";
import ReferencesPanel from "@/features/editor/ReferencesPanel.vue";
import MoveReferencesDialog from "@/shared/MoveReferencesDialog.vue";
import ToastHost from "@/shared/ToastHost.vue";
import UpdateProgressDialog from "@/shared/UpdateProgressDialog.vue";
import UpdateNotesDialog from "@/shared/UpdateNotesDialog.vue";
import PushDialog from "@/features/git/PushDialog.vue";
import UpdateProjectDialog from "@/features/git/UpdateProjectDialog.vue";
import InteractiveRebaseDialog from "@/features/git/InteractiveRebaseDialog.vue";
import { basename } from "@/shared/fs";
import { setupAutoSave } from "@/features/editor/autoSave";
import { checkForAppUpdate } from "@/shared/appUpdate";
import { isMacOS } from "@/shared/platform";
import {
  openFolderInNewWindow,
  readBootState,
} from "@/shared/openWorkspace";
import {
  getWindowSessionId,
  isMainWindowSession,
  loadWindowSessions,
  removeWindowSession,
} from "@/shared/windowSession";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
import { useSearchStore } from "@/stores/search";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import { t } from "@/i18n";

/** macOS 标题栏已挂更新入口；其它平台用右上角浮动徽章 */
const showFloatingUpdateBadge = !isMacOS();
const windowSessionId = getWindowSessionId();
const isPrimaryWindow = isMainWindowSession(windowSessionId);

const ui = useUiStore();
const workspace = useWorkspaceStore();
const editor = useEditorStore();
const search = useSearchStore();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const git = useGitStore();
const { settingsOpen } = storeToRefs(ui);

let unlistenMenu: (() => void) | undefined;
let unlistenDockMenu: (() => void) | undefined;
let unlistenAppExit: (() => void) | undefined;
let teardownAutoSave: (() => void) | undefined;
let appQuitting = false;
/** 菜单加速键与 window keydown 可能各触发一次，合并为单次切换 */
let lastTerminalToggleAt = 0;
let lastSidebarToggleAt = 0;
let lastCommitToggleAt = 0;
let pendingCommitChordTimer: number | null = null;

function toggleTerminal() {
  const now = Date.now();
  if (now - lastTerminalToggleAt < 120) return;
  lastTerminalToggleAt = now;
  sessions.toggleSessions(workspace.rootPath);
}

function toggleSidebar() {
  const now = Date.now();
  if (now - lastSidebarToggleAt < 120) return;
  lastSidebarToggleAt = now;
  settings.toggleSidebar();
}

function toggleCommitPanel() {
  const now = Date.now();
  if (now - lastCommitToggleAt < 120) return;
  lastCommitToggleAt = now;
  settings.toggleCommitPanel();
  if (
    settings.layout.activePanel === "commit" &&
    !settings.layout.sidebarCollapsed &&
    workspace.rootPath
  ) {
    void git.scheduleRefresh();
  }
}

async function locateActiveInExplorer() {
  if (!editor.activePath) {
    workspace.showNotice(t("notice.noActiveFile"));
    return;
  }
  settings.setActivePanel("explorer");
  settings.setSidebarCollapsed(false);
  await workspace.revealPath(editor.activePath);
  workspace.showNotice(t("notice.revealed", { name: basename(editor.activePath) }));
}

function handleMenuAction(action: string) {
  if (action === "open_folder") void workspace.openFolder();
  if (action === "save") void editor.saveActive();
  if (action === "settings") ui.openSettings();
  if (action === "find_file") search.openQuickOpen();
  if (action === "find_in_editor") editor.requestFind();
  if (action === "search") search.openFindInFiles();
  if (action === "terminal") toggleTerminal();
  if (action === "toggle_sidebar") toggleSidebar();
  if (action === "reveal_in_explorer") void locateActiveInExplorer();
  if (action === "git_commit") toggleCommitPanel();
}

function onKeydown(event: KeyboardEvent) {
  const mod = event.metaKey || event.ctrlKey;
  // 编辑器的 ⌘K ⌘F 是 CodeMirror chord。⌘K 单独仍保留 Commit 面板命令，
  // 但要延迟一小段时间，避免在 chord 第一笔就被窗口级快捷键抢走。
  if (pendingCommitChordTimer !== null) {
    window.clearTimeout(pendingCommitChordTimer);
    pendingCommitChordTimer = null;
  }
  if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
    if (isEditorTarget(event.target)) {
      if (!event.defaultPrevented) event.preventDefault();
      pendingCommitChordTimer = window.setTimeout(() => {
        pendingCommitChordTimer = null;
        if (isEditorTarget(document.activeElement)) toggleCommitPanel();
      }, 800);
      return;
    }
    event.preventDefault();
    toggleCommitPanel();
    return;
  }
  if (mod && event.key === ",") {
    event.preventDefault();
    ui.toggleSettings();
    return;
  }
  if (mod && event.key.toLowerCase() === "o") {
    event.preventDefault();
    void workspace.openFolder();
    return;
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void editor.saveActive();
    return;
  }
  if (mod && event.key.toLowerCase() === "p") {
    event.preventDefault();
    search.openQuickOpen();
    return;
  }
  if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    search.openFindInFiles();
    return;
  }
  // ⌘F：打开编辑器内查找。编辑器聚焦时 CM 的 Prec.highest keymap 已处理并
  // preventDefault（defaultPrevented 为 true 时跳过，避免重复打开）；
  // 失焦场景（侧边栏/终端/状态栏）靠这里兜底——macOS 原生菜单也会触发
  // requestFind，重复调用幂等无害，Windows/Linux 无原生菜单则全依赖此路径。
  if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
    if (!event.defaultPrevented) {
      event.preventDefault();
      editor.requestFind();
    }
    return;
  }
  if (mod && event.key.toLowerCase() === "j") {
    event.preventDefault();
    toggleTerminal();
    return;
  }
  if (mod && event.key.toLowerCase() === "b") {
    event.preventDefault();
    toggleSidebar();
    return;
  }
  // Alt+F1：在资源管理器中定位当前文件（对齐 WebStorm）
  if (event.altKey && !mod && event.key === "F1") {
    event.preventDefault();
    void locateActiveInExplorer();
    return;
  }
  // 以下为文本编辑强相关的快捷键，需避开输入框 / xterm / 查找面板 / 资源树过滤 / QuickOpen
  if (isEditableTarget(event.target)) return;
  // ⌘W：关闭当前标签
  if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "w") {
    event.preventDefault();
    if (editor.activePath) {
      void editor.closeTab(editor.activePath);
    }
    return;
  }
  // ⌘⌥→ / ⌘⌥←：切换到下一个 / 上一个标签
  if (mod && event.altKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
    event.preventDefault();
    if (event.key === "ArrowRight") editor.activateNextTab();
    else editor.activatePrevTab();
    return;
  }
  // ⌘R：刷新资源树
  if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    void workspace.refreshFromDisk();
    return;
  }
  if (event.key === "Escape") {
    if (search.findInFilesVisible) {
      search.closeFindInFiles();
      return;
    }
    if (search.quickOpenVisible) {
      search.closeQuickOpen();
      return;
    }
    if (settingsOpen.value) {
      ui.closeSettings();
    }
  }
}

/** 判断快捷键事件是否来自 CodeMirror 编辑区（不把普通输入框算入 chord）。 */
function isEditorTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".cm-content, .cm-editor"));
}

/** 命中输入控件时跳过文本编辑类快捷键 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // xterm / CodeMirror 内容区
  if (target.closest(".xterm, .cm-content, .cm-editor")) return true;
  return false;
}

function onWindowFocus() {
  if (!workspace.rootPath) return;
  void workspace.refreshFromDisk([], { quiet: true });
}

/** 关闭/退出前同步该窗口当前工作区的文件和终端快照。窗口索引在打开工作区时已写入。 */
function persistWindowState() {
  const root = workspace.rootPath;
  editor.persistSession(root);
  sessions.persistSession(root);
}

function onBeforeUnload() {
  persistWindowState();
}

/** 主进程发出应用退出通知后，各 WebView 先保存，随后关闭处理器才会销毁 PTY。 */
function onAppWillExit() {
  appQuitting = true;
  persistWindowState();
}

async function isApplicationQuitting(): Promise<boolean> {
  if (appQuitting) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("is_app_quitting");
  } catch {
    return appQuitting;
  }
}

async function restoreApplicationWindows(bootFolder: string | null) {
  const savedWindows = isPrimaryWindow ? loadWindowSessions() : [];

  if (bootFolder) {
    const opened = await workspace.openFolder(bootFolder, { quiet: true });
    if (!opened && !isPrimaryWindow) {
      removeWindowSession(windowSessionId);
    }
  } else if (isPrimaryWindow) {
    const mainWindow = savedWindows.find((item) => item.id === "main");
    let opened = false;
    if (mainWindow?.root) {
      opened = await workspace.openFolder(mainWindow.root, { quiet: true });
    }
    if (!opened) {
      await workspace.restoreLastFolder();
    }
  }

  // 只有主窗口负责按索引重建其它动态窗口；动态窗口自身只恢复自己的工作区。
  if (!isPrimaryWindow) return;
  for (const saved of savedWindows) {
    if (saved.id === "main" || !saved.root) continue;
    try {
      await openFolderInNewWindow(saved.root, { windowId: saved.id });
    } catch {
      removeWindowSession(saved.id);
    }
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("beforeunload", onBeforeUnload);
  teardownAutoSave = setupAutoSave({
    beforeClose: async () => {
      persistWindowState();
      // 正常关闭单个窗口时不应在下次启动重新打开；应用整体退出则保留。
      if (!(await isApplicationQuitting())) {
        removeWindowSession(windowSessionId);
      }
    },
  });
  // macOS：启动后立即把主窗口拉前（解决自动更新后需手动点 dock 才能前置的问题）。
  // 不能在 Rust setup 闭包里调 NSApp.setActivationPolicy()，会跟 tao 0.35
  // did_finish_launching 内部的 AppState::launched 时序冲突，触发
  // "panic in a function that cannot unwind"。前端 mount 时调
  // setFocus + unminimize 即可达成同样效果。
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.unminimize();
    await win.setFocus();
  } catch {
    // 纯 Vite 预览时无 Tauri runtime
  }
  try {
    unlistenAppExit = await listen("app://will-exit", onAppWillExit);
  } catch {
    // 纯 Vite 预览时无 Tauri runtime
  }
  try {
    unlistenMenu = await listen<string>("menu://action", (event) => {
      handleMenuAction(event.payload);
    });
  } catch {
    // 纯 Vite 预览时无 Tauri runtime
  }
  // macOS Dock 菜单（右键 Dock 图标弹出的菜单）点击事件。
  // payload = { id: "recent" | "open_folder", path?: string }
  // Rust 端由 commands/dock_menu.rs 的 DockMenuTarget emit。
  try {
    unlistenDockMenu = await listen<{ id: string; path?: string }>(
      "menu://dock",
      (event) => {
        const { id, path } = event.payload;
        if (id === "open_folder") {
          void workspace.openFolder();
        } else if (id === "recent" && path) {
          void workspace.openFolder(path, { quiet: true });
        }
      },
    );
  } catch {
    // 非 macOS / 纯 Vite 预览时无此事件源
  }

  const { folder: bootFolder } = readBootState();
  await restoreApplicationWindows(bootFolder);

  if (settings.settings.autoCheckUpdates) {
    window.setTimeout(() => {
      void checkForAppUpdate("auto", (message, ms) =>
        workspace.showNotice(message, ms),
      );
    }, 4000);
  }
});

onUnmounted(() => {
  if (pendingCommitChordTimer !== null) {
    window.clearTimeout(pendingCommitChordTimer);
    pendingCommitChordTimer = null;
  }
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("beforeunload", onBeforeUnload);
  editor.persistSession();
  teardownAutoSave?.();
  workspace.stopWatch();
  unlistenMenu?.();
  unlistenDockMenu?.();
  unlistenAppExit?.();
});
</script>

<template>
  <div class="shell">
    <TitleBar />
    <div
      v-if="showFloatingUpdateBadge"
      class="floating-update"
    >
      <UpdateBadge />
    </div>
    <div class="main">
      <ActivityBar />
      <SideBar />
      <div class="center">
        <EditorArea />
        <!-- 终端面板只占编辑器列：资源管理器（ActivityBar+SideBar）保持整列高度 -->
        <TerminalPanel v-if="sessions.mounted" v-show="sessions.open" />
      </div>
    </div>
    <StatusBar />
    <QuickOpen />
    <FindInFilesDialog />
    <PromptDialog />
    <ReferencesPanel />
    <MoveReferencesDialog />
    <ChoiceDialog />
    <UpdateProgressDialog />
    <UpdateNotesDialog />
    <GitAuthDialog />
    <PushDialog />
    <UpdateProjectDialog />
    <InteractiveRebaseDialog />
    <Transition name="dialog">
      <SettingsModal v-if="settingsOpen" />
    </Transition>
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  color: var(--text-primary);
  position: relative;
}

.floating-update {
  position: absolute;
  top: 8px;
  right: 4px;
  z-index: 40;
  pointer-events: none;
}

.floating-update :deep(.update-cluster) {
  pointer-events: auto;
}

.main {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--bg-app);
}

.center {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* dialog：SettingsModal 父级统一 leave 动画；其它 modal 仍走组件内 animation */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--transition-medium) var(--ease-out);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
