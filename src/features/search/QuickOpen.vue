<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Search } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import FileTypeIcon from "@/shared/FileTypeIcon.vue";
import { PLAIN_INPUT_ATTRS } from "@/shared/plainInput";
import { useI18n } from "@/i18n";
import { useEditorStore } from "@/stores/editor";
import { useSearchStore } from "@/stores/search";

const { t } = useI18n();
const search = useSearchStore();
const editor = useEditorStore();
const { fileQuery, fileResults, quickOpenVisible, loading } = storeToRefs(search);

const inputRef = ref<HTMLInputElement | null>(null);
const activeIndex = ref(0);

const displayResults = computed(() => fileResults.value);

watch(fileQuery, (q) => {
  activeIndex.value = 0;
  if (q.trim()) {
    void search.runFileSearch(q);
  } else {
    search.fileResults = [];
  }
});

watch(quickOpenVisible, async (open) => {
  if (open) {
    activeIndex.value = 0;
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
  }
});

function close() {
  search.closeQuickOpen();
}

async function openHit(index: number) {
  const hit = displayResults.value[index];
  if (!hit) return;
  close();
  await editor.openFile(hit.path);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(
      activeIndex.value + 1,
      Math.max(displayResults.value.length - 1, 0),
    );
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (displayResults.value.length) {
      void openHit(activeIndex.value);
    }
  }
}

onMounted(() => {
  if (quickOpenVisible.value) {
    inputRef.value?.focus();
  }
});
</script>

<template>
  <div v-if="quickOpenVisible" class="overlay" @mousedown.self="close">
    <div class="panel" role="dialog" :aria-label="t('search.quickOpenTitle')">
      <form class="input-row" autocomplete="off" @submit.prevent>
        <Search :size="16" class="icon" />
        <input
          ref="inputRef"
          v-model="fileQuery"
          v-bind="PLAIN_INPUT_ATTRS"
          class="query"
          type="text"
          name="miro-quick-open"
          :placeholder="t('search.quickOpenPlaceholder')"
          @keydown="onKeydown"
        />
        <span v-if="loading" class="hint">{{ t("search.searching") }}</span>
      </form>

      <div v-if="displayResults.length" class="results">
        <button
          v-for="(hit, index) in displayResults"
          :key="hit.path"
          type="button"
          class="row"
          :class="{ active: index === activeIndex }"
          @click="openHit(index)"
          @mouseenter="activeIndex = index"
        >
          <FileTypeIcon :path="hit.path" :size="14" />
          <span class="name">{{ hit.name }}</span>
          <span class="relative">{{ hit.relative }}</span>
        </button>
      </div>

      <div v-else-if="fileQuery.trim() && !loading" class="empty">
        {{ t("search.noMatchingFiles") }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: start center;
  padding-top: 12vh;
  background: var(--bg-overlay);
  backdrop-filter: blur(4px);
}

.panel {
  width: min(640px, calc(100vw - 32px));
  max-height: 60vh;
  overflow: auto;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
}

.input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  background: var(--bg-elevated);
  margin: 0;
}

.icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.query {
  flex: 1;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  outline: none;
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
}

.results {
  padding: 6px;
}

.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: left;
  color: var(--text-primary);
}

.row:hover,
.row.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.name {
  font-weight: 500;
}

.relative {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
