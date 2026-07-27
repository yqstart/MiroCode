<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
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

function toggleThemeMenu(event: MouseEvent) {
  event.stopPropagation();
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

function onDocClick() {
  themeMenuOpen.value = false;
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
      <span v-if="branch" class="branch">{{ branch }}</span>
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

.branch {
  color: var(--accent);
  font-weight: 500;
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
