<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useSettingsStore } from "@/stores/settings";
import ExplorerPanel from "@/features/explorer/ExplorerPanel.vue";
import CommitPanel from "@/features/git/CommitPanel.vue";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const settings = useSettingsStore();
const { layout } = storeToRefs(settings);

let dragging = false;

function onResizeStart(event: MouseEvent) {
  dragging = true;
  const startX = event.clientX;
  const startWidth = layout.value.sidebarWidth;

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    settings.setSidebarWidth(startWidth + (e.clientX - startX));
  };

  const onUp = () => {
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
</script>

<template>
  <aside
    v-show="!layout.sidebarCollapsed"
    class="sidebar"
    :style="{ width: `${layout.sidebarWidth}px` }"
    :aria-label="t('app.sidebar')"
  >
    <ExplorerPanel v-show="layout.activePanel === 'explorer'" />
    <CommitPanel v-show="layout.activePanel === 'commit'" />
    <div
      class="resizer"
      :title="t('app.resizeSidebar')"
      @mousedown="onResizeStart"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  height: 100%;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-subtle);
  min-width: 200px;
  max-width: 520px;
}

.resizer {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}
</style>
