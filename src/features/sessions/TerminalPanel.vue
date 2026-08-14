<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import SessionsView from "@/features/sessions/SessionsView.vue";
import { useSettingsStore } from "@/stores/settings";

const settings = useSettingsStore();

/** 拖拽手柄起始信息：拖动开始时的鼠标 Y 与面板高度 */
const drag = ref<{ startY: number; startHeight: number } | null>(null);

function startResize(event: MouseEvent) {
  event.preventDefault();
  drag.value = {
    startY: event.clientY,
    startHeight: settings.layout.terminalPanelHeight,
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function onMove(event: MouseEvent) {
  if (!drag.value) return;
  // 鼠标上移（startY - clientY > 0）时面板变高
  const next = drag.value.startHeight + (drag.value.startY - event.clientY);
  settings.setTerminalPanelHeight(next);
}

function onUp() {
  drag.value = null;
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mouseup", onUp);
}

onBeforeUnmount(() => {
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mouseup", onUp);
});
</script>

<template>
  <section
    class="terminal-panel"
    :style="{ height: `${settings.layout.terminalPanelHeight}px` }"
  >
    <div
      class="resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整终端面板高度"
      @mousedown="startResize"
    />
    <div class="panel-body">
      <SessionsView />
    </div>
  </section>
</template>

<style scoped>
.terminal-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  border-top: 1px solid var(--border-subtle);
  /* 防御：小窗口下拖拽高度上限以窗口剩余空间为界 */
  max-height: calc(100vh - var(--titlebar-height) - var(--status-bar-height) - 48px);
}

.resize-handle {
  flex-shrink: 0;
  height: 4px;
  cursor: row-resize;
  touch-action: none;
}

.resize-handle:hover {
  background: var(--accent-soft);
}

.panel-body {
  flex: 1;
  min-height: 0;
}
</style>
