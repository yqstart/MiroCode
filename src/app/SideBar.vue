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
  <Transition name="sidebar">
    <aside
      v-if="!layout.sidebarCollapsed"
      class="sidebar"
      :style="{ width: `${layout.sidebarWidth}px` }"
      :aria-label="t('app.sidebar')"
    >
      <Transition name="panel-fade" mode="out-in">
        <ExplorerPanel v-if="layout.activePanel === 'explorer'" key="explorer" />
        <CommitPanel v-else-if="layout.activePanel === 'commit'" key="commit" />
      </Transition>
      <div
        class="resizer"
        :title="t('app.resizeSidebar')"
        @mousedown="onResizeStart"
      />
    </aside>
  </Transition>
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar > :deep(*) {
  flex-shrink: 0;
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

/* sidebar：展开/收起：宽度 + 透明度 */
.sidebar-enter-active {
  transition: width var(--transition-medium) var(--ease-out),
    opacity var(--transition-medium) var(--ease-out);
}
.sidebar-leave-active {
  transition: width var(--transition-fast) var(--ease-out),
    opacity var(--transition-fast) var(--ease-out);
}
.sidebar-enter-from,
.sidebar-leave-to {
  width: 0 !important;
  opacity: 0;
}

/* panel-fade：explorer ↔ commit 切换淡入 */
.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity var(--transition-fast) var(--ease-out);
}
.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
}
</style>
