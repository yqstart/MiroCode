<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { GitBranch } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { THEME_LABELS, THEME_ORDER } from "@/features/editor/theme";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
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
const { snapshot, branches, loading } = storeToRefs(git);

const themeMenuOpen = ref(false);
const branchMenuOpen = ref(false);
const branchFilter = ref("");
const branchFilterRef = ref<HTMLInputElement | null>(null);

const lang = computed(() => activeTab.value?.language ?? "—");
const cursor = computed(() => activeTab.value?.cursor ?? { line: 1, column: 1 });
const dirty = computed(() =>
  activeTab.value ? activeTab.value.content !== activeTab.value.original : false,
);
const branch = computed(() =>
  snapshot.value.initialized ? snapshot.value.branch : null,
);
const themeLabel = computed(() => THEME_LABELS[theme.value]);

const themeOptions = computed(() =>
  THEME_ORDER.map((id) => ({ id, label: THEME_LABELS[id] })),
);

const localBranches = computed(() => {
  const q = branchFilter.value.trim().toLowerCase();
  return branches.value
    .filter((b) => !b.isRemote)
    .filter((b) => !q || b.name.toLowerCase().includes(q));
});

function toggleThemeMenu(event: MouseEvent) {
  event.stopPropagation();
  branchMenuOpen.value = false;
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

async function toggleBranchMenu(event: MouseEvent) {
  event.stopPropagation();
  if (!branch.value) return;
  themeMenuOpen.value = false;
  const next = !branchMenuOpen.value;
  branchMenuOpen.value = next;
  if (next) {
    branchFilter.value = "";
    if (!branches.value.length) await git.refresh();
    await nextTick();
    branchFilterRef.value?.focus();
  }
}

async function selectBranch(name: string) {
  if (name === branch.value) {
    branchMenuOpen.value = false;
    return;
  }
  branchMenuOpen.value = false;
  await git.checkout(name);
}

function onDocClick() {
  themeMenuOpen.value = false;
  branchMenuOpen.value = false;
}

onMounted(() => {
  window.addEventListener("click", onDocClick);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", onDocClick);
});
</script>

<template>
  <footer class="status-bar">
    <div class="left">
      <span>{{ workspace.rootName }}</span>
      <div v-if="branch" class="branch-switch" @click.stop>
        <button
          type="button"
          class="branch-btn"
          title="切换分支"
          @click="toggleBranchMenu"
        >
          <GitBranch :size="12" />
          <span class="branch-name">{{ branch }}</span>
        </button>
        <div
          v-if="branchMenuOpen"
          class="branch-menu"
          role="menu"
          aria-label="切换分支"
        >
          <div class="branch-filter">
            <input
              ref="branchFilterRef"
              v-model="branchFilter"
              v-bind="PLAIN_INPUT_ATTRS"
              class="filter-input"
              type="text"
              placeholder="筛选分支…"
              @keydown.escape.stop="branchMenuOpen = false"
            />
          </div>
          <div class="branch-list">
            <button
              v-for="b in localBranches"
              :key="b.name"
              type="button"
              class="branch-item"
              :class="{ active: b.isHead }"
              role="menuitem"
              @click="selectBranch(b.name)"
            >
              {{ b.name }}
            </button>
            <p v-if="!localBranches.length" class="branch-empty">
              {{ loading ? "加载中…" : "无匹配分支" }}
            </p>
          </div>
        </div>
      </div>
      <span class="sep">·</span>
      <span>{{ lang }}</span>
      <span class="sep">·</span>
      <span>UTF-8</span>
      <span v-if="dirty" class="dirty">未保存</span>
      <span v-if="snapshot.conflictCount > 0" class="conflict">
        {{ snapshot.conflictCount }} 冲突
      </span>
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
  max-width: 180px;
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

.branch-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  width: min(280px, 70vw);
  max-height: min(360px, 50vh);
  padding: 6px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.branch-filter {
  flex-shrink: 0;
}

.filter-input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: 12px;
}

.filter-input:focus {
  outline: 1px solid var(--accent);
  outline-offset: 0;
}

.branch-list {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}

.branch-item {
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.branch-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.branch-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.branch-empty {
  margin: 0;
  padding: 10px 8px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.sep {
  color: var(--text-muted);
}

.notice {
  margin-left: 8px;
  color: var(--accent);
}

.dirty {
  margin-left: 8px;
  color: var(--warning);
}

.conflict {
  margin-left: 8px;
  color: var(--danger);
}

.ok {
  color: var(--success);
}

.theme-switch {
  position: relative;
}

.theme-btn {
  padding: 2px 6px;
  margin: -2px 0;
  border-radius: 4px;
  color: var(--text-secondary);
  line-height: 1.2;
}

.theme-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.theme-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  min-width: 148px;
  padding: 4px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.theme-item {
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--text-primary);
  white-space: nowrap;
}

.theme-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.theme-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
</style>
