<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from "vue";
import { PanelLeft, PanelLeftClose, TerminalSquare } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import UpdateBadge from "@/app/UpdateBadge.vue";
import { formatShortcut, isMacOS } from "@/shared/platform";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const settings = useSettingsStore();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const { layout } = storeToRefs(settings);
const { rootPath } = storeToRefs(workspace);

/** 仅 macOS Overlay 标题栏需要与红绿灯同排的控件 */
const visible = isMacOS();

const collapsed = computed(() => layout.value.sidebarCollapsed);
const tip = computed(() =>
  t(collapsed.value ? "title.expandSidebar" : "title.collapseSidebar", {
    shortcut: formatShortcut("mod", "B"),
  }),
);

const terminalTip = computed(() =>
  t("editor.openTerminal") + " · " + formatShortcut("mod", "J"),
);

function openTerminal() {
  sessions.openSessions(workspace.rootPath);
}

/** 全屏时原生红绿灯隐藏，折叠按钮应贴左 */
const isFullscreen = ref(false);

async function syncTrafficLights() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("sync_traffic_lights");
  } catch {
    // 纯 Vite 预览或非 macOS
  }
}

async function refreshFullscreen() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    isFullscreen.value = await getCurrentWindow().isFullscreen();
  } catch {
    isFullscreen.value = false;
  }
}

let unlistenResize: (() => void) | undefined;
const timers: number[] = [];

onMounted(() => {
  if (!visible) return;

  void refreshFullscreen();
  // 启动瞬间调一次即可；后续由 Rust 端 install_traffic_light_hooks
  // 监听 Resized/ThemeChanged/ScaleFactorChanged/Focused 事件统一重排。
  // 不在前端做 80/300/900ms 延迟补排，避免与 hook 事件 setFrame 抢位置造成抖动。
  void syncTrafficLights();

  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      unlistenResize = await getCurrentWindow().onResized(() => {
        void refreshFullscreen();
        void syncTrafficLights();
      });
    } catch {
      // 非桌面壳
    }
  })();
});

onUnmounted(() => {
  unlistenResize?.();
  for (const id of timers) window.clearTimeout(id);
});
</script>

<template>
  <header v-if="visible" class="titlebar" :aria-label="t('app.titleBar')">
    <!-- 为原生红绿灯预留空间；全屏时收起，折叠按钮贴左 -->
    <div
      class="traffic-spacer"
      :class="{ fullscreen: isFullscreen }"
      data-tauri-drag-region
    />
    <button
      type="button"
      class="sidebar-btn"
      :title="tip"
      :aria-label="tip"
      :aria-pressed="!collapsed"
      @click="settings.toggleSidebar()"
    >
      <Transition name="icon" mode="out-in">
        <PanelLeftClose v-if="!collapsed" :key="'open'" :size="15" :stroke-width="1.75" />
        <PanelLeft v-else :key="'closed'" :size="15" :stroke-width="1.75" />
      </Transition>
    </button>
    <div class="drag-fill" data-tauri-drag-region />
    <!-- 右上角：终端开启按钮（与红绿灯同排，UpdateBadge 之前） -->
    <button
      type="button"
      class="terminal-btn"
      :title="terminalTip"
      :aria-label="terminalTip"
      :disabled="!rootPath"
      @click="openTerminal"
    >
      <TerminalSquare :size="15" :stroke-width="1.75" />
    </button>
    <UpdateBadge />
  </header>
</template>

<style scoped>
.titlebar {
  height: var(--titlebar-height);
  /* 杀掉 <header> UA 默认 margin: 1em 0（约 13px），否则会撑高标题栏
     导致原生红绿灯（垂直中线 19pt）与 .titlebar 内的折叠按钮（被挤到 ~32pt）错位 */
  margin: 0;
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
  transition: width var(--transition-fast);
}

.traffic-spacer.fullscreen {
  width: var(--space-2);
}

.sidebar-btn,
.terminal-btn {
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

.terminal-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.terminal-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* icon crossfade：sidebar 折叠按钮切换 */
.icon-enter-active,
.icon-leave-active {
  transition: opacity var(--transition-fast) var(--ease-out),
    transform var(--transition-medium) var(--ease-out);
}
.icon-enter-from {
  opacity: 0;
  transform: rotate(-90deg) scale(0.85);
}
.icon-leave-to {
  opacity: 0;
  transform: rotate(90deg) scale(0.85);
}

.drag-fill {
  flex: 1;
  height: 100%;
  min-width: 0;
}
</style>
