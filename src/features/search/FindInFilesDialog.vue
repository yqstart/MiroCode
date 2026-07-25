<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { Replace, Search, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { useEditorStore } from "@/stores/editor";
import { useSearchStore } from "@/stores/search";

const search = useSearchStore();
const editor = useEditorStore();
const {
  contentQuery,
  replaceText,
  caseSensitive,
  extensions,
  contentResults,
  replacePreview,
  loading,
  findInFilesVisible,
  history,
} = storeToRefs(search);

const queryRef = ref<HTMLInputElement | null>(null);
const showReplace = ref(false);
const activeIndex = ref(0);

watch(findInFilesVisible, async (open) => {
  if (!open) return;
  activeIndex.value = 0;
  await nextTick();
  queryRef.value?.focus();
  queryRef.value?.select();
});

watch(contentResults, () => {
  activeIndex.value = 0;
});

function close() {
  search.closeFindInFiles();
}

function onOverlay(event: MouseEvent) {
  if (event.target === event.currentTarget) close();
}

async function onSearch() {
  await search.runContentSearch();
}

async function onPreviewReplace() {
  showReplace.value = true;
  await search.previewReplace();
}

async function onApplyReplace() {
  if (!replacePreview.value) {
    await search.previewReplace();
  }
  if (!replacePreview.value?.replacements) return;
  const ok = window.confirm(
    `将替换 ${replacePreview.value.replacements} 处，涉及 ${replacePreview.value.changedFiles} 个文件。确定继续？`,
  );
  if (!ok) return;
  await search.applyReplace();
}

async function openHit(index: number, keepOpen = false) {
  const hit = contentResults.value[index];
  if (!hit) return;
  await editor.openFileAt(hit.path, hit.line, hit.column);
  if (!keepOpen) close();
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
      Math.max(contentResults.value.length - 1, 0),
    );
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    if (document.activeElement === queryRef.value) {
      event.preventDefault();
      void onSearch();
      return;
    }
    if (contentResults.value.length) {
      event.preventDefault();
      void openHit(activeIndex.value, event.metaKey || event.ctrlKey);
    }
  }
}

function useHistory(item: string) {
  contentQuery.value = item;
  void onSearch();
}
</script>

<template>
  <div
    v-if="findInFilesVisible"
    class="overlay"
    @mousedown="onOverlay"
    @keydown="onKeydown"
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-label="在文件中查找">
      <header class="header">
        <div class="title-row">
          <Search :size="18" class="title-icon" />
          <h1>在文件中查找</h1>
          <span class="hint">WebStorm 风格 · ⌘⇧F</span>
        </div>
        <button type="button" class="icon-btn" title="关闭" @click="close">
          <X :size="18" />
        </button>
      </header>

      <div class="form">
        <label class="field">
          <span class="label">查找</span>
          <input
            ref="queryRef"
            v-model="contentQuery"
            class="ui-input"
            type="search"
            placeholder="输入要查找的文本…"
            @keydown.enter.exact.prevent="onSearch"
          />
        </label>

        <div v-if="showReplace" class="field">
          <span class="label">替换为</span>
          <div class="replace-row">
            <Replace :size="14" class="inline-icon" />
            <input
              v-model="replaceText"
              class="ui-input"
              type="text"
              placeholder="替换文本…"
            />
          </div>
        </div>

        <div class="options">
          <label class="check">
            <input v-model="caseSensitive" type="checkbox" />
            区分大小写
          </label>
          <label class="field inline">
            <span class="label">文件掩码</span>
            <input
              v-model="extensions"
              class="ui-input mask"
              type="text"
              placeholder="ts, vue, md（可选）"
            />
          </label>
          <div class="actions">
            <button
              type="button"
              class="btn ghost"
              @click="showReplace = !showReplace"
            >
              {{ showReplace ? "隐藏替换" : "替换" }}
            </button>
            <button
              v-if="showReplace"
              type="button"
              class="btn ghost"
              :disabled="loading"
              @click="onPreviewReplace"
            >
              预览
            </button>
            <button
              v-if="showReplace"
              type="button"
              class="btn"
              :disabled="loading"
              @click="onApplyReplace"
            >
              全部替换
            </button>
            <button
              type="button"
              class="btn"
              :disabled="loading || !contentQuery.trim()"
              @click="onSearch"
            >
              {{ loading ? "搜索中…" : "查找" }}
            </button>
          </div>
        </div>

        <div v-if="history.length && !contentQuery.trim()" class="history">
          <span class="history-label">最近搜索</span>
          <button
            v-for="item in history.slice(0, 8)"
            :key="item"
            type="button"
            class="history-chip"
            @click="useHistory(item)"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <div v-if="replacePreview" class="preview-banner">
        预览：{{ replacePreview.replacements }} 处 ·
        {{ replacePreview.changedFiles }} 个文件
        <span v-if="replacePreview.files.length">
          — {{ replacePreview.files.slice(0, 4).join(", ")
          }}{{ replacePreview.files.length > 4 ? "…" : "" }}
        </span>
      </div>

      <div class="results">
        <div class="results-meta">
          <template v-if="loading">正在搜索项目…</template>
          <template v-else-if="contentResults.length">
            {{ contentResults.length }} 条匹配
            <span class="meta-hint">↑↓ 选择 · Enter 打开 · ⌘Enter 打开并保持窗口</span>
          </template>
          <template v-else-if="contentQuery.trim()">无匹配结果</template>
          <template v-else>输入关键词后按 Enter 或点击「查找」</template>
        </div>

        <div class="list">
          <button
            v-for="(hit, index) in contentResults"
            :key="`${hit.path}:${hit.line}:${hit.column}`"
            type="button"
            class="hit"
            :class="{ active: index === activeIndex }"
            @click="openHit(index)"
            @dblclick="openHit(index)"
          >
            <span class="loc">{{ hit.relative }}:{{ hit.line }}</span>
            <span class="preview">{{ hit.preview }}</span>
          </button>
        </div>
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
  place-items: center;
  padding: 32px;
  background: var(--bg-overlay);
  backdrop-filter: blur(6px);
}

.dialog {
  width: min(860px, 100%);
  height: min(640px, 100%);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-row h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.title-icon {
  color: var(--accent);
}

.hint {
  font-size: 11px;
  color: var(--text-muted);
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.form {
  padding: 14px 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 48px;
}

.ui-input {
  width: 100%;
}

.replace-row {
  position: relative;
}

.inline-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.replace-row .ui-input {
  padding-left: 32px;
}

.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.mask {
  width: 180px;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.btn {
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
  font-size: 12px;
}

.btn.ghost {
  background: var(--accent-soft);
  color: var(--accent);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.history {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.history-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 4px;
}

.history-chip {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--bg-app);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.history-chip:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.preview-banner {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-bottom: 1px solid var(--border-subtle);
}

.results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.results-meta {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
}

.meta-hint {
  margin-left: 10px;
  color: var(--text-muted);
  opacity: 0.85;
}

.list {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.hit {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 12px;
  border-radius: 8px;
  text-align: left;
}

.hit:hover,
.hit.active {
  background: var(--accent-soft);
}

.loc {
  font-size: 12px;
  color: var(--accent);
  font-family: var(--font-mono);
}

.preview {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
