<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { GitBranch } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import BranchesPopup from "@/features/git/BranchesPopup.vue";
import { THEME_LABELS, THEME_ORDER } from "@/features/editor/theme";
import type { ThemeId } from "@/shared/types";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const editor = useEditorStore();
const git = useGitStore();
const { editor: editorPrefs, theme } = storeToRefs(settings);
const { activeTab } = storeToRefs(editor);
const { snapshot } = storeToRefs(git);

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
  if (!parts.length && upstream) return "已同步";
  return parts.join(" ");
});
const themeLabel = computed(() => THEME_LABELS[theme.value]);

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

function toggleBranches(event: MouseEvent) {
  event.stopPropagation();
  if (!branch.value) return;
  themeMenuOpen.value = false;
  branchesOpen.value = !branchesOpen.value;
}

function onDocClick() {
  themeMenuOpen.value = false;
}

onMounted(() => window.addEventListener("click", onDocClick));
onBeforeUnmount(() => window.removeEventListener("click", onDocClick));
</script>

<template>
  <footer class="status-bar">
    <div class="left">
      <span>{{ workspace.rootName }}</span>
      <div v-if="branch" class="branch-switch" @click.stop>
        <button
          type="button"
          class="branch-btn"
          title="Git Branches"
          @click="toggleBranches"
        >
          <GitBranch :size="12" />
          <span class="branch-name">{{ branch }}</span>
          <span v-if="syncLabel" class="sync-label">{{ syncLabel }}</span>
        </button>
      </div>
      <span class="sep">·</span>
      <span>{{ lang }}</span>
      <span class="sep">·</span>
      <span>UTF-8</span>
      <span v-if="dirty" class="dirty">未保存</span>
      <button
        v-if="snapshot.conflictCount > 0"
        type="button"
        class="conflict"
        title="打开冲突解决"
        @click="git.openFirstConflict()"
      >
        {{ snapshot.conflictCount }} 冲突
      </button>
      <span v-if="workspace.notice" class="notice">{{ workspace.notice }}</span>
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
          title="点击切换主题 · 右键循环"
          @click="toggleThemeMenu"
          @contextmenu.prevent="cycleTheme"
        >
          {{ themeLabel }}
        </button>
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
      </div>
      <span class="sep">·</span>
      <span class="ok">就绪</span>
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
  padding: 0 12px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 12px;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.branch-switch {
  position: relative;
}

.branch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
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

.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-label {
  font-size: 11px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.sep {
  color: var(--text-muted);
}

.dirty {
  color: var(--warning);
}

.conflict {
  color: var(--danger);
  font-weight: 600;
  cursor: pointer;
}

.conflict:hover {
  text-decoration: underline;
}

.notice {
  color: var(--accent);
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-switch {
  position: relative;
}

.theme-btn {
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-secondary);
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
}

.theme-item {
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
}

.theme-item:hover,
.theme-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.ok {
  color: var(--success);
}
</style>
