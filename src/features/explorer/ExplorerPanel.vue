<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Crosshair,
  File,
  Folder,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  X,
} from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { basename, dirname } from "@/shared/fs";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
import { useSettingsStore } from "@/stores/settings";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const editor = useEditorStore();
const git = useGitStore();
const settings = useSettingsStore();
const {
  rootPath,
  rootName,
  filter,
  selectedPath,
  flatTree,
  recentFolders,
  clipboard,
  revealToken,
  revealTarget,
  locateHits,
  locateLoading,
  refreshing,
} = storeToRefs(workspace);
const { activePath } = storeToRefs(editor);

const menu = ref<{ x: number; y: number; path: string; isDir: boolean } | null>(
  null,
);
const filterRef = ref<HTMLInputElement | null>(null);
const treeBodyRef = ref<HTMLElement | null>(null);

const dirtySet = computed(() => editor.dirtyPaths);
const canLocate = computed(() => Boolean(rootPath.value && activePath.value));

function scrollRowIntoView(path: string) {
  const root = treeBodyRef.value;
  if (!root) return;
  const rows = root.querySelectorAll<HTMLElement>("[data-tree-path]");
  for (const row of rows) {
    if (row.dataset.treePath === path) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("flash");
      window.setTimeout(() => row.classList.remove("flash"), 900);
      break;
    }
  }
}

onMounted(async () => {
  if (rootPath.value) void git.refresh();
  if (revealTarget.value) {
    await nextTick();
    scrollRowIntoView(revealTarget.value);
  }
});

watch([revealToken, revealTarget], async ([, path]) => {
  if (!path) return;
  await nextTick();
  scrollRowIntoView(path);
});

watch(activePath, (path) => {
  if (!path || !rootPath.value) return;
  // 编辑区切换标签时自动在树中高亮定位
  if (settings.layout.activePanel !== "explorer") return;
  if (settings.layout.sidebarCollapsed) return;
  void workspace.revealPath(path);
});

function closeMenu() {
  menu.value = null;
}

async function onOpen() {
  await workspace.openFolder();
}

async function onOpenRecent(path: string) {
  await workspace.openFolder(path);
}

async function onRowClick(path: string, isDir: boolean) {
  workspace.selectPath(path);
  if (isDir) {
    await workspace.toggleExpand(path);
    return;
  }
  await editor.openFile(path);
}

function onContext(event: MouseEvent, path: string, isDir: boolean) {
  event.preventDefault();
  workspace.selectPath(path);
  menu.value = { x: event.clientX, y: event.clientY, path, isDir };
}

async function locateActiveFile() {
  if (!activePath.value) {
    workspace.showNotice("当前没有打开的文件");
    return;
  }
  settings.setActivePanel("explorer");
  settings.setSidebarCollapsed(false);
  await workspace.revealPath(activePath.value);
  workspace.showNotice(`已定位 ${basename(activePath.value)}`);
}

function focusFilter() {
  filterRef.value?.focus();
  filterRef.value?.select();
}

async function onLocateHit(path: string) {
  await workspace.revealPath(path);
  await editor.openFile(path);
}

async function onFilterEnter() {
  const hit = locateHits.value[0];
  if (hit) {
    await onLocateHit(hit.path);
    return;
  }
  const firstFile = flatTree.value.find((n) => !n.isDir);
  if (firstFile) {
    await onRowClick(firstFile.path, false);
  }
}

async function runMenu(action: string) {
  if (!menu.value || !rootPath.value) return;
  const { path, isDir } = menu.value;
  const parent = isDir ? path : dirname(path);
  closeMenu();

  if (action === "new-file") {
    const created = await workspace.createIn(parent, false);
    if (created) await editor.openFile(created);
    return;
  }
  if (action === "new-folder") {
    await workspace.createIn(parent, true);
    return;
  }
  if (action === "rename") {
    const result = await workspace.renamePath(path);
    if (result) {
      editor.renameTabPath(result.from, result.to);
    }
    return;
  }
  if (action === "delete") {
    const ok = await workspace.removePath(path);
    if (ok) editor.closeTabsUnder(path);
    return;
  }
  if (action === "copy") {
    workspace.setClipboard("copy", path);
    return;
  }
  if (action === "cut") {
    workspace.setClipboard("cut", path);
    return;
  }
  if (action === "paste") {
    const result = await workspace.pasteInto(parent);
    if (result?.cut) {
      editor.renameTabPath(result.from, result.to);
    }
    return;
  }
  if (action === "copy-path") {
    await navigator.clipboard.writeText(path);
    workspace.showNotice("路径已复制");
    return;
  }
  if (action === "reveal") {
    await workspace.revealPath(path);
  }
  if (action === "locate-here") {
    await workspace.revealPath(path);
    if (!isDir) await editor.openFile(path);
  }
}

defineExpose({ locateActiveFile, focusFilter });
</script>

<template>
  <div class="panel" @click="closeMenu">
    <header class="header">
      <span class="title">资源管理器</span>
      <div v-if="rootPath" class="header-actions">
        <button
          type="button"
          class="icon-btn"
          title="刷新资源管理器与打开的文件"
          :disabled="refreshing"
          @click.stop="workspace.refreshFromDisk()"
        >
          <RefreshCw :size="15" :class="{ spin: refreshing }" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="定位到当前打开的文件（⌥F1）"
          :disabled="!canLocate"
          @click.stop="locateActiveFile"
        >
          <Crosshair :size="15" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="折叠全部文件夹"
          @click.stop="workspace.collapseAll()"
        >
          <ChevronsDownUp :size="15" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="打开其他文件夹"
          @click.stop="onOpen"
        >
          <MoreHorizontal :size="16" />
        </button>
      </div>
    </header>

    <div v-if="rootPath" class="toolbar">
      <div class="filter-wrap">
        <input
          ref="filterRef"
          class="ui-input filter"
          type="search"
          placeholder="过滤 / 定位文件…"
          :value="filter"
          @input="workspace.setFilter(($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="onFilterEnter"
          @keydown.escape.prevent="workspace.clearFilter()"
        />
        <button
          v-if="filter"
          type="button"
          class="clear"
          title="清除"
          @click="workspace.clearFilter()"
        >
          <X :size="12" />
        </button>
      </div>
      <p v-if="locateLoading" class="filter-hint">全项目检索中…</p>
      <p v-else-if="filter.trim() && locateHits.length" class="filter-hint">
        {{ locateHits.length }} 个定位结果 · Enter 打开首项
      </p>
    </div>

    <div ref="treeBodyRef" class="body">
      <template v-if="!rootPath">
        <div class="empty">
          <FolderOpen :size="28" :stroke-width="1.5" class="icon" />
          <p class="name">{{ rootName }}</p>
          <p class="hint">打开本地文件夹后展示项目树</p>
          <button class="cta" type="button" @click="onOpen">打开文件夹…</button>
          <div v-if="recentFolders.length" class="recent">
            <p class="recent-title">最近打开</p>
            <button
              v-for="item in recentFolders"
              :key="item"
              type="button"
              class="recent-item"
              :title="item"
              @click="onOpenRecent(item)"
            >
              {{ basename(item) }}
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div
          v-if="filter.trim() && locateHits.length"
          class="locate-block"
        >
          <div class="locate-title">快速定位</div>
          <button
            v-for="hit in locateHits"
            :key="hit.path"
            type="button"
            class="locate-hit"
            :class="{ active: selectedPath === hit.path }"
            :data-tree-path="hit.path"
            :title="hit.path"
            @click="onLocateHit(hit.path)"
          >
            <File :size="13" class="file-icon" />
            <span class="locate-name">{{ hit.name }}</span>
            <span class="locate-rel">{{ hit.relative }}</span>
          </button>
        </div>

        <div
          class="root-label"
          :data-tree-path="rootPath"
          @contextmenu="onContext($event, rootPath, true)"
        >
          {{ rootName }}
        </div>
        <div class="tree">
          <button
            v-for="node in flatTree"
            :key="node.path"
            type="button"
            class="row"
            :class="{
              active: selectedPath === node.path,
              dirty: dirtySet.has(node.path),
            }"
            :data-tree-path="node.path"
            :style="{ paddingLeft: `${10 + node.depth * 14}px` }"
            @click="onRowClick(node.path, node.isDir)"
            @contextmenu="onContext($event, node.path, node.isDir)"
          >
            <span class="twist">
              <template v-if="node.isDir">
                <ChevronDown v-if="node.expanded" :size="14" />
                <ChevronRight v-else :size="14" />
              </template>
            </span>
            <Folder v-if="node.isDir && !node.expanded" :size="14" class="file-icon folder" />
            <FolderOpen v-else-if="node.isDir" :size="14" class="file-icon folder" />
            <File v-else :size="14" class="file-icon" />
            <span class="label">{{ node.name }}</span>
            <span
              v-if="!node.isDir && git.statusColor(node.path)"
              class="git-dot"
              :style="{ background: git.statusColor(node.path) ?? undefined }"
            />
            <span v-if="dirtySet.has(node.path)" class="dirty-dot" />
          </button>
          <div
            v-if="filter.trim() && !flatTree.length && !locateHits.length && !locateLoading"
            class="empty-filter"
          >
            无匹配文件
          </div>
        </div>
      </template>
    </div>

    <div
      v-if="menu"
      class="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
    >
      <button type="button" @click="runMenu('new-file')">新建文件</button>
      <button type="button" @click="runMenu('new-folder')">新建文件夹</button>
      <hr />
      <button type="button" @click="runMenu('rename')">重命名</button>
      <button type="button" @click="runMenu('delete')">删除</button>
      <hr />
      <button type="button" @click="runMenu('copy')">复制</button>
      <button type="button" @click="runMenu('cut')">剪切</button>
      <button type="button" :disabled="!clipboard" @click="runMenu('paste')">
        粘贴
      </button>
      <hr />
      <button type="button" @click="runMenu('copy-path')">复制路径</button>
      <button type="button" @click="runMenu('locate-here')">在树中定位并打开</button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.toolbar {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.filter-wrap {
  position: relative;
}

.filter {
  width: 100%;
  height: 30px;
  padding-right: 28px;
}

.clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.clear:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.filter-hint {
  margin: 6px 2px 0;
  font-size: 11px;
  color: var(--text-muted);
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.icon {
  color: var(--text-muted);
}

.name {
  margin: 0;
  font-weight: 600;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.cta {
  margin-top: 8px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 500;
}

.recent {
  margin-top: 16px;
  width: 100%;
  text-align: left;
}

.recent-title {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.recent-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.locate-block {
  padding: 8px 8px 4px;
  border-bottom: 1px solid var(--border-subtle);
}

.locate-title {
  padding: 0 6px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

.locate-hit {
  width: 100%;
  display: grid;
  grid-template-columns: 16px minmax(0, auto) minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: left;
  color: var(--text-primary);
}

.locate-hit:hover,
.locate-hit.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.locate-name {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.locate-rel {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.root-label {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

.tree {
  padding: 4px 6px 12px;
}

.row {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border-radius: 6px;
  color: var(--text-primary);
  text-align: left;
}

.row:hover {
  background: var(--accent-soft);
}

.row.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.row:deep(.flash),
.row.flash {
  animation: flash-row 0.9s ease;
}

@keyframes flash-row {
  0% {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  100% {
    box-shadow: none;
  }
}

.twist {
  width: 14px;
  height: 14px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-icon.folder {
  color: var(--accent);
  opacity: 0.85;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}

.git-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-left: auto;
}

.dirty-dot {
  margin-left: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.empty-filter {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.menu {
  position: fixed;
  z-index: 40;
  min-width: 180px;
  padding: 6px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
}

.menu button {
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--text-primary);
}

.menu button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.menu button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.menu hr {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 4px 0;
}
</style>
