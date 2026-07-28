<script setup lang="ts">
import { onMounted, onUnmounted, computed } from "vue";
import { PanelLeft, PanelLeftClose } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { formatShortcut, isMacOS } from "@/shared/platform";
import { useSettingsStore } from "@/stores/settings";

const settings = useSettingsStore();
const { layout } = storeToRefs(settings);

/** 仅 macOS Overlay 标题栏需要与红绿灯同排的控件 */
const visible = isMacOS();

const collapsed = computed(() => layout.value.sidebarCollapsed);
const tip = computed(() => {
  const action = collapsed.value ? "展开侧边栏" : "折叠侧边栏";
  return `${action}（${formatShortcut("mod", "B")}）`;
});

async function syncTrafficLights() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("sync_traffic_lights");
  } catch {
    // 纯 Vite 预览或非 macOS
  }
}

onMounted(() => {
  if (!visible) return;
  // 首帧布局后再对齐；AppKit 偶发重置，延迟补一次
  void syncTrafficLights();
  window.setTimeout(() => void syncTrafficLights(), 50);
  window.setTimeout(() => void syncTrafficLights(), 300);
  window.addEventListener("resize", syncTrafficLights);
});

onUnmounted(() => {
  window.removeEventListener("resize", syncTrafficLights);
});
</script>

<template>
  <header v-if="visible" class="titlebar" aria-label="标题栏">
    <!-- 为原生红绿灯预留空间；不可点击区域可拖拽 -->
    <div class="traffic-spacer" data-tauri-drag-region />
    <button
      type="button"
      class="sidebar-btn"
      :title="tip"
      :aria-label="tip"
      :aria-pressed="!collapsed"
      @click="settings.toggleSidebar()"
    >
      <PanelLeftClose v-if="!collapsed" :size="15" :stroke-width="1.75" />
      <PanelLeft v-else :size="15" :stroke-width="1.75" />
    </button>
    <div class="drag-fill" data-tauri-drag-region />
  </header>
</template>

<style scoped>
.titlebar {
  height: var(--titlebar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border-subtle);
}

.traffic-spacer {
  width: var(--traffic-light-pad);
  height: 100%;
  flex-shrink: 0;
}

.sidebar-btn {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.sidebar-btn:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.drag-fill {
  flex: 1;
  height: 100%;
  min-width: 0;
}
</style>
