<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { THEME_LABELS } from "@/features/editor/theme";
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

const lang = computed(() => activeTab.value?.language ?? "—");
const cursor = computed(() => activeTab.value?.cursor ?? { line: 1, column: 1 });
const dirty = computed(() =>
  activeTab.value ? activeTab.value.content !== activeTab.value.original : false,
);
const branch = computed(() =>
  snapshot.value.initialized ? snapshot.value.branch : null,
);
const themeLabel = computed(() => THEME_LABELS[theme.value]);
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
      <span>{{ themeLabel }}</span>
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
</style>
