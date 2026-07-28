<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Files, GitBranch, Package, Settings, TerminalSquare } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import PackageScriptsMenu from "@/features/sessions/PackageScriptsMenu.vue";
import { useGitStore } from "@/stores/git";
import { usePackageScriptsStore } from "@/stores/packageScripts";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import type { SidePanelId } from "@/shared/types";

const settings = useSettingsStore();
const ui = useUiStore();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const git = useGitStore();
const pkg = usePackageScriptsStore();
const { layout } = storeToRefs(settings);
const { isFocused } = storeToRefs(sessions);
const { changedFileCount } = storeToRefs(git);
const { available } = storeToRefs(pkg);

const scriptsOpen = ref(false);
const scriptsBtn = ref<HTMLButtonElement | null>(null);
const popStyle = ref<Record<string, string>>({});

const gitBadge = computed(() => {
  const n = changedFileCount.value;
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
});

function selectPanel(panel: SidePanelId) {
  scriptsOpen.value = false;
  if (layout.value.activePanel === panel && !layout.value.sidebarCollapsed) {
    settings.toggleSidebar();
    return;
  }
  settings.setActivePanel(panel);
  if (panel === "git" && workspace.rootPath) {
    void git.refresh();
  }
}

function openTerminal() {
  scriptsOpen.value = false;
  sessions.openSessions(workspace.rootPath);
}

function placePop() {
  const el = scriptsBtn.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  popStyle.value = {
    left: `${rect.right + 8}px`,
    bottom: `${window.innerHeight - rect.bottom}px`,
  };
}

async function toggleScripts() {
  if (scriptsOpen.value) {
    scriptsOpen.value = false;
    return;
  }
  await pkg.refresh(true);
  scriptsOpen.value = true;
  await nextTick();
  placePop();
}

function onDocPointer(event: MouseEvent) {
  if (!scriptsOpen.value) return;
  const target = event.target as Node | null;
  if (scriptsBtn.value?.contains(target)) return;
  const pop = document.getElementById("miro-scripts-pop");
  if (pop?.contains(target)) return;
  scriptsOpen.value = false;
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") scriptsOpen.value = false;
}

onMounted(() => {
  document.addEventListener("mousedown", onDocPointer);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", placePop);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocPointer);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", placePop);
});
</script>

<template>
  <aside class="activity-bar" aria-label="活动栏">
    <div class="group">
      <button
        class="item"
        type="button"
        title="资源管理器"
        :class="{ active: layout.activePanel === 'explorer' && !layout.sidebarCollapsed }"
        @click="selectPanel('explorer')"
      >
        <Files :size="20" :stroke-width="1.75" />
      </button>
      <button
        class="item"
        type="button"
        :title="gitBadge ? `Git · ${changedFileCount} 个变更文件` : 'Git'"
        :class="{ active: layout.activePanel === 'git' && !layout.sidebarCollapsed }"
        @click="selectPanel('git')"
      >
        <GitBranch :size="20" :stroke-width="1.75" />
        <span v-if="gitBadge" class="badge">{{ gitBadge }}</span>
      </button>
    </div>

    <div class="group">
      <button
        ref="scriptsBtn"
        class="item"
        type="button"
        title="运行 package.json scripts"
        :class="{ active: scriptsOpen }"
        :disabled="!workspace.rootPath"
        @click="toggleScripts"
      >
        <Package :size="18" :stroke-width="1.75" />
        <span v-if="available && !scriptsOpen" class="dot" />
      </button>
      <button
        class="item"
        type="button"
        title="终端"
        :class="{ active: isFocused }"
        @click="openTerminal"
      >
        <TerminalSquare :size="18" :stroke-width="1.75" />
      </button>
      <button class="item" type="button" title="设置" @click="ui.openSettings()">
        <Settings :size="18" :stroke-width="1.75" />
      </button>
    </div>
  </aside>

  <Teleport to="body">
    <div
      v-if="scriptsOpen"
      id="miro-scripts-pop"
      class="scripts-pop"
      :style="popStyle"
      role="dialog"
      aria-label="package.json scripts"
    >
      <PackageScriptsMenu variant="panel" @ran="scriptsOpen = false" />
    </div>
  </Teleport>
</template>

<style scoped>
.activity-bar {
  width: var(--activity-bar-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-subtle);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}

.item {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  color: var(--text-muted);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.item:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.item.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}

.item:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.badge {
  position: absolute;
  top: 1px;
  right: -1px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
  background: var(--accent);
  color: var(--accent-fg, #fff);
  box-shadow: 0 0 0 1px var(--bg-panel);
  pointer-events: none;
}

.dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--bg-panel);
  pointer-events: none;
}

.scripts-pop {
  position: fixed;
  z-index: 70;
  width: min(360px, calc(100vw - 56px));
  max-height: min(420px, 70vh);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
}
</style>
