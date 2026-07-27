<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Crosshair,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  RefreshCw,
} from "lucide-vue-next";
import { open } from "@tauri-apps/plugin-dialog";
import { storeToRefs } from "pinia";
import { writeClipboard } from "@/shared/clipboard";
import { basename, dirname, relativeToRoot } from "@/shared/fs";
import { openFolderInNewWindow } from "@/shared/openWorkspace";
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
  selectedPath,
  flatTree,
  recentFolders,
  clipboard,
  childrenMap,
  revealToken,
  revealTarget,
  refreshing,
} = storeToRefs(workspace);
const { activePath } = storeToRefs(editor);

const menu = ref<{
  x: number;
  y: number;
  path: string;
  isDir: boolean;
  isRoot: boolean;
} | null>(null);
const treeBodyRef = ref<HTMLElement | null>(null);
const projectMenuOpen = ref(false);
const pendingOpenPath = ref<string | null>(null);
const openingMode = ref(false);

const dirtySet = computed(() => editor.dirtyPaths);
const canLocate = computed(() => Boolean(rootPath.value && activePath.value));
const isRootTarget = computed(() => Boolean(menu.value?.isRoot));
const panelTitle = computed(() => (rootPath.value ? rootName.value : "选择项目"));
const switchCandidates = computed(() =>
  recentFolders.value.filter((p) => p !== rootPath.value),
);

/** 工具栏新建：优先落在选中目录，否则落在选中文件的父目录 / 根目录 */
function resolveCreateParent(): string | null {
  if (!rootPath.value) return null;
  const selected = selectedPath.value;
  if (!selected || selected === rootPath.value) return rootPath.value;

  const inTree = flatTree.value.find((n) => n.path === selected);
  if (inTree?.isDir) return selected;
  if (selected in childrenMap.value) return selected;
  return dirname(selected);
}

async function createFromToolbar(isDir: boolean) {
  const parent = resolveCreateParent();
  if (!parent) return;
  const created = await workspace.createIn(parent, isDir);
  if (created && !isDir) await editor.openFile(created);
}

function closeProjectMenu() {
  projectMenuOpen.value = false;
}

function toggleProjectMenu() {
  projectMenuOpen.value = !projectMenuOpen.value;
  menu.value = null;
}

function requestOpenPath(path: string) {
  closeProjectMenu();
  pendingOpenPath.value = path;
}

async function onOpenNewProject() {
  closeProjectMenu();
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "打开新项目",
    });
    if (!selected || Array.isArray(selected)) return;
    pendingOpenPath.value = selected;
  } catch (error) {
    workspace.showNotice(error instanceof Error ? error.message : String(error), 3200);
  }
}

async function confirmOpenMode(mode: "current" | "new") {
  const path = pendingOpenPath.value;
  if (!path || openingMode.value) return;
  openingMode.value = true;
  try {
    if (mode === "new") {
      await openFolderInNewWindow(path);
      workspace.showNotice(`已在新窗口打开 ${basename(path)}`);
    } else {
      await workspace.openFolder(path);
    }
    pendingOpenPath.value = null;
  } catch (error) {
    workspace.showNotice(error instanceof Error ? error.message : String(error), 3200);
  } finally {
    openingMode.value = false;
  }
}

function cancelOpenMode() {
  if (openingMode.value) return;
  pendingOpenPath.value = null;
}

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
  closeProjectMenu();
}

async function onOpen() {
  await onOpenNewProject();
}

async function onOpenRecent(path: string) {
  requestOpenPath(path);
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
  event.stopPropagation();
  workspace.selectPath(path);
  const menuWidth = 200;
  const menuHeight = 320;
  const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
  const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
  menu.value = {
    x: Math.max(8, x),
    y: Math.max(8, y),
    path,
    isDir,
    isRoot: Boolean(rootPath.value && path === rootPath.value),
  };
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

async function runMenu(action: string) {
  if (!menu.value || !rootPath.value) return;
  const { path, isDir, isRoot } = menu.value;
  const parent = isDir ? path : dirname(path);
  closeMenu();

  try {
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
      if (isRoot) {
        workspace.showNotice("不能重命名工作区根目录");
        return;
      }
      const result = await workspace.renamePath(path);
      if (result) {
        editor.renameTabPath(result.from, result.to);
      }
      return;
    }
    if (action === "delete") {
      if (isRoot) {
        workspace.showNotice("不能删除工作区根目录");
        return;
      }
      const ok = await workspace.removePath(path);
      if (ok) editor.closeTabsUnder(path);
      return;
    }
    if (action === "copy") {
      workspace.setClipboard("copy", path);
      return;
    }
    if (action === "cut") {
      if (isRoot) {
        workspace.showNotice("不能剪切工作区根目录");
        return;
      }
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
    if (action === "copy-abs-path") {
      await writeClipboard(path);
      workspace.showNotice("已复制绝对路径");
      return;
    }
    if (action === "copy-rel-path") {
      const rel = relativeToRoot(rootPath.value, path);
      await writeClipboard(rel);
      workspace.showNotice("已复制相对路径");
    }
  } catch (error) {
    workspace.showNotice(
      error instanceof Error ? error.message : String(error),
      3200,
    );
  }
}

defineExpose({ locateActiveFile });
</script>

<template>
  <div class="panel" @click="closeMenu">
    <header class="header">
      <div class="title-wrap">
        <button
          type="button"
          class="title-btn"
          :title="rootPath ?? '选择或切换项目'"
          @click.stop="toggleProjectMenu"
        >
          <span class="title">{{ panelTitle }}</span>
          <ChevronDown :size="14" class="title-caret" />
        </button>
        <div v-if="projectMenuOpen" class="project-menu" @click.stop>
          <button type="button" class="project-item primary" @click="onOpenNewProject">
            <FolderInput :size="14" />
            <span>打开新项目…</span>
          </button>
          <template v-if="switchCandidates.length">
            <div class="project-sep" />
            <p class="project-label">最近项目</p>
            <button
              v-for="item in switchCandidates"
              :key="item"
              type="button"
              class="project-item"
              :title="item"
              @click="requestOpenPath(item)"
            >
              <span class="project-name">{{ basename(item) }}</span>
              <span class="project-path">{{ item }}</span>
            </button>
          </template>
        </div>
      </div>
      <div v-if="rootPath" class="header-actions">
        <button
          type="button"
          class="icon-btn"
          title="新建文件"
          @click.stop="createFromToolbar(false)"
        >
          <FilePlus :size="15" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="新建文件夹"
          @click.stop="createFromToolbar(true)"
        >
          <FolderPlus :size="15" />
        </button>
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
      </div>
    </header>

    <div
      v-if="pendingOpenPath"
      class="mode-overlay"
      @mousedown.self="cancelOpenMode"
    >
      <div class="mode-card" @click.stop>
        <p class="mode-title">打开项目</p>
        <p class="mode-path" :title="pendingOpenPath">
          {{ basename(pendingOpenPath) }}
        </p>
        <button
          type="button"
          class="mode-btn"
          :disabled="openingMode"
          @click="confirmOpenMode('current')"
        >
          在本窗口打开
        </button>
        <button
          type="button"
          class="mode-btn accent"
          :disabled="openingMode"
          @click="confirmOpenMode('new')"
        >
          在新窗口打开
        </button>
        <button
          type="button"
          class="mode-cancel"
          :disabled="openingMode"
          @click="cancelOpenMode"
        >
          取消
        </button>
      </div>
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
          class="tree"
          @contextmenu="onContext($event, rootPath, true)"
        >
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
        </div>
      </template>
    </div>

    <div
      v-if="menu"
      class="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <button type="button" @click="runMenu('new-file')">新建文件</button>
      <button type="button" @click="runMenu('new-folder')">新建文件夹</button>
      <hr />
      <button
        type="button"
        :disabled="isRootTarget"
        @click="runMenu('rename')"
      >
        重命名
      </button>
      <button
        type="button"
        :disabled="isRootTarget"
        @click="runMenu('delete')"
      >
        删除
      </button>
      <hr />
      <button type="button" @click="runMenu('copy')">复制</button>
      <button
        type="button"
        :disabled="isRootTarget"
        @click="runMenu('cut')"
      >
        剪切
      </button>
      <button type="button" :disabled="!clipboard" @click="runMenu('paste')">
        粘贴
      </button>
      <hr />
      <button type="button" @click="runMenu('copy-abs-path')">复制绝对路径</button>
      <button type="button" @click="runMenu('copy-rel-path')">复制相对路径</button>
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

.title-wrap {
  position: relative;
  min-width: 0;
  flex: 1;
  margin-right: 6px;
}

.title-btn {
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 2px 6px 2px 4px;
  border-radius: 6px;
  color: var(--text-secondary);
}

.title-btn:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.title {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-caret {
  flex-shrink: 0;
  opacity: 0.7;
}

.project-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  min-width: 220px;
  max-width: min(320px, 70vw);
  padding: 6px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
}

.project-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  text-align: left;
  color: var(--text-primary);
}

.project-item.primary {
  font-weight: 600;
  color: var(--accent);
}

.project-item:hover {
  background: var(--accent-soft);
}

.project-item .project-name {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.project-item .project-path {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-item:not(.primary) {
  flex-direction: column;
  gap: 2px;
}

.project-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--border-subtle);
}

.project-label {
  margin: 2px 10px 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.mode-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: var(--bg-overlay);
}

.mode-card {
  width: min(280px, calc(100% - 24px));
  padding: 16px;
  border-radius: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.mode-path {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-btn {
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-app);
  color: var(--text-primary);
  font-weight: 500;
}

.mode-btn.accent {
  background: var(--accent);
  border-color: transparent;
  color: var(--accent-fg);
}

.mode-btn:disabled,
.mode-cancel:disabled {
  opacity: 0.55;
  cursor: wait;
}

.mode-cancel {
  height: 28px;
  color: var(--text-muted);
  font-size: 12px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
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

.tree {
  min-height: 100%;
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
