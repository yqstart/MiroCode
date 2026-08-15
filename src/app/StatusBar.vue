<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { GitBranch, TerminalSquare } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import BranchesPopup from "@/features/git/BranchesPopup.vue";
import { THEME_LABELS, THEME_ORDER } from "@/features/editor/theme";
import type { ThemeId } from "@/shared/types";
import { formatShortcut } from "@/shared/platform";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const settings = useSettingsStore();
const ui = useUiStore();
const workspace = useWorkspaceStore();
const editor = useEditorStore();
const git = useGitStore();
const sessions = useSessionsStore();
const { editor: editorPrefs, theme } = storeToRefs(settings);
const { activeTab } = storeToRefs(editor);
const { snapshot } = storeToRefs(git);
const { open: terminalOpen } = storeToRefs(sessions);

const themeMenuOpen = ref(false);
const branchesOpen = ref(false);

const lang = computed(() => activeTab.value?.language ?? "—");
const cursor = computed(() => activeTab.value?.cursor ?? { line: 1, column: 1 });
const dirty = computed(() =>
  activeTab.value ? activeTab.value.content !== activeTab.value.original : false,
);
const branch = computed(() =>
  snapshot.value.initialized ? snapshot.value.branch : null,
);
const syncLabel = computed(() => {
  if (!snapshot.value.initialized) return "";
  const { ahead, behind, upstream } = snapshot.value;
  if (!upstream && !ahead && !behind) return "";
  const parts: string[] = [];
  if (ahead) parts.push(`↑${ahead}`);
  if (behind) parts.push(`↓${behind}`);
  if (!parts.length && upstream) return t("status.synced");
  return parts.join(" ");
});
const themeLabel = computed(() => THEME_LABELS[theme.value]);

/** 状态栏终端开关：提示语随面板显隐变化 */
const terminalTip = computed(
  () =>
    t(terminalOpen.value ? "status.hideTerminal" : "status.openTerminal") +
    " · " +
    formatShortcut("mod", "J"),
);

/** 未打开项目时终端 cwd 用 home 目录兜底（提供「先开终端再选项目」路径） */
const homeDir = ref<string | null>(null);
async function loadHomeDir() {
  try {
    const { homeDir: get } = await import("@tauri-apps/api/path");
    homeDir.value = await get();
  } catch {
    homeDir.value = null;
  }
}

async function loadHomeDirFallback(): Promise<string | null> {
  await loadHomeDir();
  return homeDir.value;
}

function toggleTerminal() {
  if (terminalOpen.value) {
    sessions.hideSessions();
    return;
  }
  void (async () => {
    let cwd = workspace.rootPath;
    if (!cwd) {
      cwd = homeDir.value ?? (await loadHomeDirFallback());
    }
    sessions.openSessions(cwd);
  })();
}

// LSP 状态指示器
const lspStatus = ref<string>("disabled");

const lspStatusLabel = computed(() => {
  if (!editorPrefs.value.lspEnabled) return "";
  switch (lspStatus.value) {
    case "ready":
      return t("lsp.statusReady");
    case "starting":
    case "checking":
      return t("lsp.statusStarting");
    case "unavailable":
    case "error":
      return t("lsp.statusUnavailable");
    default:
      return "";
  }
});

const lspStatusClass = computed(() => {
  switch (lspStatus.value) {
    case "ready":
      return "lsp-ok";
    case "unavailable":
    case "error":
      return "lsp-warn";
    default:
      return "lsp-info";
  }
});

// AI 补全状态指示器
const aiStatus = ref<string>("disabled");

const aiStatusLabel = computed(() => {
  if (!editorPrefs.value.aiCompletion.enabled) return "";
  switch (aiStatus.value) {
    case "requesting":
    case "streaming":
      return t("status.aiThinking");
    case "error":
      return t("status.aiError");
    case "idle":
      return t("status.aiReady");
    default:
      return "";
  }
});

const aiStatusClass = computed(() => {
  switch (aiStatus.value) {
    case "streaming":
      return "ai-active";
    case "error":
      return "ai-warn";
    case "idle":
      return "ai-info";
    default:
      return "ai-info";
  }
});

const themeOptions = computed(() =>
  THEME_ORDER.map((id) => ({ id, label: THEME_LABELS[id] })),
);

function toggleThemeMenu(event: MouseEvent) {
  event.stopPropagation();
  branchesOpen.value = false;
  themeMenuOpen.value = !themeMenuOpen.value;
}

function selectTheme(id: ThemeId) {
  settings.setTheme(id);
  themeMenuOpen.value = false;
}

function cycleTheme() {
  const idx = THEME_ORDER.indexOf(theme.value);
  const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length] ?? THEME_ORDER[0];
  settings.setTheme(next);
}

/** 点击 LSP 指示器：打开设置面板的语言服务分区 */
function openLsPanel() {
  ui.openSettings("editor");
}

function toggleBranches(event: MouseEvent) {
  event.stopPropagation();
  if (!branch.value) return;
  themeMenuOpen.value = false;
  branchesOpen.value = !branchesOpen.value;
}

function onDocClick() {
  themeMenuOpen.value = false;
}

// LSP 状态订阅（替代每 2s 轮询）
let unsubLsp: (() => void) | null = null;
let unsubAi: (() => void) | null = null;
let disposed = false;

onMounted(() => {
  window.addEventListener("click", onDocClick);
  // 预取 home 目录，未打开项目时终端 cwd 用它兜底
  void loadHomeDir();
  void import("@/features/lsp/manager").then(({ lspManager }) => {
    // import 完成前组件已卸载：不再订阅，否则退订函数无人调用、永久留在
    // statusHandlers 数组
    if (disposed) return;
    unsubLsp = lspManager.onStatusChange((status) => {
      lspStatus.value = status;
    });
  });
  void import("@/features/ai/manager").then(({ aiManager }) => {
    if (disposed) return;
    unsubAi = aiManager.onStatusChange((status) => {
      aiStatus.value = status;
    });
  });
});

onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener("click", onDocClick);
  unsubLsp?.();
  unsubLsp = null;
  unsubAi?.();
  unsubAi = null;
});
</script>

<template>
  <footer class="status-bar">
    <div class="left">
      <button
        type="button"
        class="terminal-btn"
        :class="{ active: terminalOpen }"
        :title="terminalTip"
        :aria-label="terminalTip"
        :aria-pressed="terminalOpen"
        @click="toggleTerminal"
      >
        <TerminalSquare :size="13" />
      </button>
      <span class="root-name" :title="workspace.rootName">{{
        workspace.rootName
      }}</span>
      <div v-if="branch" class="branch-switch" @click.stop>
        <button
          type="button"
          class="branch-btn"
          :title="`Git Branches · ${branch}${syncLabel ? ` · ${syncLabel}` : ''}`"
          @click="toggleBranches"
        >
          <GitBranch :size="12" class="branch-icon" />
          <span class="branch-name">{{ branch }}</span>
          <span v-if="syncLabel" class="sync-label">{{ syncLabel }}</span>
        </button>
      </div>
      <span class="sep">·</span>
      <span class="meta">{{ lang }}</span>
      <span class="sep">·</span>
      <span class="meta">UTF-8</span>
      <span v-if="dirty" class="dirty">{{ t("status.unsaved") }}</span>
      <button
        v-if="snapshot.conflictCount > 0"
        type="button"
        class="conflict"
        :title="t('status.openConflict')"
        @click="git.openFirstConflict()"
      >
        {{ t("status.conflicts", { count: snapshot.conflictCount }) }}
      </button>
      <button
        v-if="lspStatusLabel"
        type="button"
        class="lsp-status"
        :class="lspStatusClass"
        :data-state="lspStatus"
        :title="lspStatusLabel + ' · ' + t('lsp.statusClickHint')"
        @click="openLsPanel"
      >{{ lspStatusLabel }}</button>
      <span
        v-if="aiStatusLabel"
        class="ai-status"
        :class="aiStatusClass"
        :data-state="aiStatus"
        :title="aiStatusLabel"
      >{{ aiStatusLabel }}</span>
    </div>
    <div class="right">
      <span>Ln {{ cursor.line }}, Col {{ cursor.column }}</span>
      <span class="sep">·</span>
      <span>Spaces: {{ editorPrefs.tabSize }}</span>
      <span class="sep">·</span>
      <div class="theme-switch" @click.stop>
        <button
          type="button"
          class="theme-btn"
          :title="t('status.switchThemeHint')"
          @click="toggleThemeMenu"
          @contextmenu.prevent="cycleTheme"
        >
          {{ themeLabel }}
        </button>
        <Transition name="popover">
          <div v-if="themeMenuOpen" class="theme-menu" role="menu">
            <button
              v-for="item in themeOptions"
              :key="item.id"
              type="button"
              class="theme-item"
              :class="{ active: theme === item.id }"
              role="menuitem"
              @click="selectTheme(item.id)"
            >
              {{ item.label }}
            </button>
          </div>
        </Transition>
      </div>
      <span class="sep">·</span>
      <span class="ok">{{ t("status.ready") }}</span>
    </div>
  </footer>

  <BranchesPopup :open="branchesOpen" @close="branchesOpen = false" />
</template>

<style scoped>
.status-bar {
  height: var(--status-bar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  min-width: 0;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.left {
  flex: 1;
  overflow: hidden;
}

.right {
  flex-shrink: 0;
}

.root-name {
  flex-shrink: 1;
  min-width: 0;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 左下角终端开关按钮：VS Code 风格，active 态高亮 */
.terminal-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  transition: color var(--transition-fast) var(--ease-out),
    background var(--transition-fast) var(--ease-out);
}

.terminal-btn:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.terminal-btn.active {
  color: var(--accent);
}

.branch-switch {
  position: relative;
  min-width: 0;
  flex-shrink: 1;
}

.branch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
  padding: 2px 6px;
  margin: -2px 0;
  border-radius: 4px;
  color: var(--accent);
  font-weight: 500;
  line-height: 1.2;
}

.branch-btn:hover {
  background: var(--accent-soft);
}

.branch-icon {
  flex-shrink: 0;
}

.branch-name {
  min-width: 0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-label {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.meta {
  flex-shrink: 0;
}

.sep {
  color: var(--text-muted);
  flex-shrink: 0;
}

.dirty {
  color: var(--warning);
  flex-shrink: 0;
}

.conflict {
  color: var(--danger);
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.conflict:hover {
  text-decoration: underline;
}

.lsp-status {
  font-size: 11px;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.lsp-status:hover {
  background: var(--accent-soft);
}

.lsp-ok {
  color: var(--success, #22c55e);
}

.lsp-warn {
  color: var(--warning, #f59e0b);
  animation: lsp-pulse 2s ease-in-out infinite;
}

.lsp-info {
  color: var(--text-muted);
}

@keyframes lsp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* AI 补全状态指示器 */
.ai-status {
  font-size: 11px;
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 3px;
}

.ai-active {
  color: var(--accent, #6366f1);
}

.ai-warn {
  color: var(--warning, #f59e0b);
}

.ai-info {
  color: var(--text-muted);
}

.theme-switch {
  position: relative;
}

.theme-btn {
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-secondary);
  transition: background var(--transition-fast) var(--ease-out),
    color var(--transition-fast) var(--ease-out);
}

.theme-btn:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.theme-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  min-width: 140px;
  padding: 4px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  z-index: 30;
  display: flex;
  flex-direction: column;
  transform-origin: bottom right;
}

.theme-item {
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  transition: background var(--transition-fast) var(--ease-out),
    color var(--transition-fast) var(--ease-out);
}

.theme-item:hover,
.theme-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

/* popover：theme menu 等浮层（与 ActivityBar/scripts-pop 共用） */
.popover-enter-active {
  transition: opacity var(--transition-medium) var(--ease-out),
    transform var(--transition-medium) var(--ease-out);
}
.popover-leave-active {
  transition: opacity var(--transition-fast) var(--ease-out),
    transform var(--transition-fast) var(--ease-out);
}
.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(4px);
}

/* AI / LSP 状态点：颜色态切换平滑 + 启动中脉动 */
.ai-status,
.lsp-status {
  transition: color var(--transition-medium) var(--ease-out),
    background var(--transition-fast) var(--ease-out);
}

/* 启动/请求中：短脉动（lsp-warn 的 2s 慢脉动太慢，starting/streaming 给 1.6s 快脉动） */
.lsp-status[data-state="starting"],
.ai-status[data-state="requesting"],
.ai-status[data-state="streaming"] {
  animation: miro-status-pulse 1.6s ease-in-out infinite;
}

.ok {
  color: var(--success);
}
</style>
