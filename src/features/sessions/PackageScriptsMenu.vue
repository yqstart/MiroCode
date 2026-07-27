<script setup lang="ts">
import { Play, RefreshCw } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { usePackageScriptsStore } from "@/stores/packageScripts";

const props = defineProps<{
  /** compact：终端顶栏横滑；panel：活动栏弹层列表 */
  variant?: "compact" | "panel";
}>();

const emit = defineEmits<{
  ran: [];
}>();

const pkg = usePackageScriptsStore();
const { scripts, manager, packageName, loading, hasPackageJson } =
  storeToRefs(pkg);

async function onRun(name: string) {
  await pkg.runScript(name);
  emit("ran");
}

async function onRefresh() {
  await pkg.refresh(true);
}
</script>

<template>
  <div class="scripts" :data-variant="props.variant ?? 'panel'">
    <header class="head">
      <div class="title-wrap">
        <span class="title">Scripts</span>
        <span v-if="packageName" class="pkg">{{ packageName }}</span>
        <span v-if="hasPackageJson" class="pm">{{ manager }}</span>
      </div>
      <button
        type="button"
        class="icon-btn"
        title="刷新 package.json"
        :disabled="loading"
        @click="onRefresh"
      >
        <RefreshCw :size="13" :class="{ spin: loading }" />
      </button>
    </header>

    <div v-if="loading && !scripts.length" class="hint">读取 scripts…</div>
    <div v-else-if="!hasPackageJson" class="hint">当前项目无 package.json</div>
    <div v-else-if="!scripts.length" class="hint">package.json 中没有 scripts</div>
    <div v-else class="list">
      <button
        v-for="item in scripts"
        :key="item.name"
        type="button"
        class="row"
        :title="item.script"
        @click="onRun(item.name)"
      >
        <Play :size="12" class="play" />
        <span class="name">{{ item.name }}</span>
        <span class="cmd">{{ item.script }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.scripts {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.pkg {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}

.icon-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.icon-btn:disabled {
  opacity: 0.5;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hint {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  overflow: auto;
  max-height: 320px;
}

.row {
  width: 100%;
  display: grid;
  grid-template-columns: 16px minmax(72px, auto) 1fr;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: left;
  color: var(--text-primary);
}

.row:hover {
  background: var(--accent-soft);
}

.play {
  color: var(--accent);
  flex-shrink: 0;
}

.name {
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.cmd {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

/* 终端顶栏：横向滚动芯片 */
.scripts[data-variant="compact"] {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 0;
  border: none;
  min-height: 0;
}

.scripts[data-variant="compact"] .head {
  border: none;
  padding: 0;
  gap: 6px;
  flex-shrink: 0;
}

.scripts[data-variant="compact"] .pkg,
.scripts[data-variant="compact"] .hint {
  display: none;
}

.scripts[data-variant="compact"] .list {
  flex-direction: row;
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  max-height: none;
  padding: 0;
  gap: 4px;
}

.scripts[data-variant="compact"] .row {
  width: auto;
  display: inline-flex;
  grid-template-columns: none;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  white-space: nowrap;
}

.scripts[data-variant="compact"] .cmd {
  display: none;
}

.scripts[data-variant="compact"] .name {
  font-size: 11px;
  font-weight: 500;
}
</style>
