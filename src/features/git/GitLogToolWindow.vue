<script setup lang="ts">
import { computed, watch } from "vue";
import { X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import GitLogPanel from "@/features/git/GitLogPanel.vue";
import { useGitStore } from "@/stores/git";
import { useSettingsStore } from "@/stores/settings";

const settings = useSettingsStore();
const git = useGitStore();
const { layout } = storeToRefs(settings);

const open = computed(() => layout.value.gitLogWindow.open);
const height = computed(() => layout.value.gitLogWindow.height);

watch(open, (isOpen) => {
  if (isOpen) void git.loadLog(80);
});

function close() {
  settings.setGitLogWindowOpen(false);
}

function onResizeStart(event: MouseEvent) {
  const startY = event.clientY;
  const startH = height.value;
  const onMove = (e: MouseEvent) => {
    settings.setGitLogWindowHeight(startH + (startY - e.clientY));
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
</script>

<template>
  <section
    v-show="open"
    class="tool-window"
    :style="{ height: `${height}px` }"
    aria-label="Git Log"
  >
    <div class="h-resizer" title="拖拽调整高度" @mousedown="onResizeStart" />
    <header class="tabs">
      <span class="tab active">Git Log</span>
      <button type="button" class="icon-btn" title="隐藏" @click="close">
        <X :size="14" />
      </button>
    </header>
    <div class="body">
      <GitLogPanel />
    </div>
  </section>
</template>

<style scoped>
.tool-window {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 160px;
  max-height: 70vh;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-subtle);
  position: relative;
}

.h-resizer {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  z-index: 3;
}

.tabs {
  flex-shrink: 0;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.tab {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  border-bottom: 2px solid var(--accent);
  height: 100%;
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
}

.icon-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
