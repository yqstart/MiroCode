<script setup lang="ts">
import { Files, GitBranch, Settings, TerminalSquare } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { useGitStore } from "@/stores/git";
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
const { layout } = storeToRefs(settings);
const { isFocused } = storeToRefs(sessions);

function selectPanel(panel: SidePanelId) {
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
  sessions.openSessions(workspace.rootPath);
}
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
        title="Git"
        :class="{ active: layout.activePanel === 'git' && !layout.sidebarCollapsed }"
        @click="selectPanel('git')"
      >
        <GitBranch :size="20" :stroke-width="1.75" />
      </button>
    </div>

    <div class="group">
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
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  color: var(--text-muted);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.item:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.item.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
</style>
