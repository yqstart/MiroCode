<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { storeToRefs } from "pinia";
import { listen } from "@tauri-apps/api/event";
import ActivityBar from "@/app/ActivityBar.vue";
import SideBar from "@/app/SideBar.vue";
import EditorArea from "@/app/EditorArea.vue";
import StatusBar from "@/app/StatusBar.vue";
import FindInFilesDialog from "@/features/search/FindInFilesDialog.vue";
import QuickOpen from "@/features/search/QuickOpen.vue";
import SettingsModal from "@/features/settings/SettingsModal.vue";
import { basename } from "@/shared/fs";
import { useEditorStore } from "@/stores/editor";
import { useSearchStore } from "@/stores/search";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";

const ui = useUiStore();
const workspace = useWorkspaceStore();
const editor = useEditorStore();
const search = useSearchStore();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const { settingsOpen } = storeToRefs(ui);

let unlistenMenu: (() => void) | undefined;

async function locateActiveInExplorer() {
  if (!editor.activePath) {
    workspace.showNotice("当前没有打开的文件");
    return;
  }
  settings.setActivePanel("explorer");
  settings.setSidebarCollapsed(false);
  await workspace.revealPath(editor.activePath);
  workspace.showNotice(`已定位 ${basename(editor.activePath)}`);
}

function handleMenuAction(action: string) {
  if (action === "open_folder") void workspace.openFolder();
  if (action === "save") void editor.saveActive();
  if (action === "settings") ui.openSettings();
  if (action === "find_file") search.openQuickOpen();
  if (action === "search") search.openFindInFiles();
  if (action === "terminal") sessions.openSessions(workspace.rootPath);
  if (action === "reveal_in_explorer") void locateActiveInExplorer();
}

function onKeydown(event: KeyboardEvent) {
  const mod = event.metaKey || event.ctrlKey;
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
  if (mod && (event.key === "`" || event.code === "Backquote")) {
    event.preventDefault();
    sessions.openSessions(workspace.rootPath);
    return;
  }
  // Alt+F1：在资源管理器中定位当前文件（对齐 WebStorm）
  if (event.altKey && !mod && event.key === "F1") {
    event.preventDefault();
    void locateActiveInExplorer();
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

function onWindowFocus() {
  if (!workspace.rootPath) return;
  void workspace.refreshFromDisk([], { quiet: true });
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("focus", onWindowFocus);
  try {
    unlistenMenu = await listen<string>("menu://action", (event) => {
      handleMenuAction(event.payload);
    });
  } catch {
    // 纯 Vite 预览时无 Tauri runtime
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("focus", onWindowFocus);
  workspace.stopWatch();
  unlistenMenu?.();
});
</script>

<template>
  <div class="shell">
    <div class="main">
      <ActivityBar />
      <SideBar />
      <EditorArea />
    </div>
    <StatusBar />
    <QuickOpen />
    <FindInFilesDialog />
    <SettingsModal v-if="settingsOpen" />
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
}

.main {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
