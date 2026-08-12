<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from "vue";
import { PanelLeft, PanelLeftClose, TerminalSquare, Copy, Check } from "lucide-vue-next";
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

/** 全局项目标题：项目名（粗体 ≤24 字符自动截断）+ 完整路径（淡灰，ellipsis） */
const MAX_NAME = 24;
const projectTitle = computed(() => {
  if (!rootPath.value) return t("title.noFolder");
  const name = rootPath.value.split("/").filter(Boolean).pop() ?? t("title.noFolder");
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
});
const projectPath = computed(() => rootPath.value ?? "");

/** 点击标题复制完整路径到剪贴板（带视觉反馈） */
const copied = ref(false);
let copiedTimer: number | null = null;
async function copyProjectPath() {
  if (!rootPath.value) return;
  try {
    await navigator.clipboard.writeText(rootPath.value);
    copied.value = true;
    if (copiedTimer != null) window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied.value = false;
    }, 1200);
  } catch {
    // 剪贴板被拒权，忽略
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
  if (copiedTimer != null) window.clearTimeout(copiedTimer);
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
    <!-- 全局项目标题：项目名（粗）+ 路径（淡灰），点击复制完整路径 -->
    <button
      type="button"
      class="project-title"
      :disabled="!rootPath"
      :title="rootPath ? t('title.copyPath') : ''"
      :aria-label="projectPath"
      data-tauri-drag-region="false"
      @click="copyProjectPath"
    >
      <span class="project-name" data-tauri-drag-region>{{ projectTitle }}</span>
      <span v-if="rootPath" class="project-sep" data-tauri-drag-region>·</span>
      <span v-if="rootPath" class="project-path" data-tauri-drag-region>{{ projectPath }}</span>
      <Transition name="copied">
        <Check v-if="copied" :size="12" class="copy-check" />
        <Copy v-else-if="rootPath" :size="12" class="copy-icon" />
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

/* 终端入口：与红绿灯那侧对称的右留白
   （红绿灯侧 .traffic-spacer 78px 含控件 + trafficLightPosition.x:14 边距） */
.terminal-btn {
  margin-left: var(--space-3);
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

/* 全局项目标题：可点击整行复制路径；内部文字继续走 data-tauri-drag-region 让标题栏可拖 */
.project-title {
  flex-shrink: 1;
  min-width: 0;
  max-width: 50%;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
  background: transparent;
  border: none;
  cursor: default;
  transition: background var(--transition-fast), color var(--transition-fast);
  /* 标题区域默认吃掉点击作为拖拽，但 button 本身可点；按钮禁用时不响应事件 */
  -webkit-app-region: no-drag;
}
.project-title:not(:disabled):hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}
.project-name {
  font-weight: 600;
  white-space: nowrap;
  -webkit-app-region: drag;
}
.project-sep {
  color: var(--text-muted);
  -webkit-app-region: drag;
}
.project-path {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-app-region: drag;
}
.copy-icon,
.copy-check {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
  -webkit-app-region: no-drag;
}
.project-title:hover .copy-icon {
  opacity: 0.7;
}
.copy-check {
  color: #34d399;
  opacity: 1;
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

/* 复制成功 tick 淡入淡出 */
.copied-enter-active,
.copied-leave-active {
  transition: opacity var(--transition-fast) var(--ease-out),
    transform var(--transition-fast) var(--ease-out);
}
.copied-enter-from,
.copied-leave-to {
  opacity: 0;
  transform: scale(0.6);
}

.drag-fill {
  flex: 1;
  height: 100%;
  min-width: 0;
}
</style>
