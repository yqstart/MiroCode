<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { basename, dirname } from "@/shared/fs";
import { useEditorStore } from "@/stores/editor";
import { useGitStore } from "@/stores/git";
import { useWorkspaceStore } from "@/stores/workspace";

const workspace = useWorkspaceStore();
const editor = useEditorStore();
const git = useGitStore();
const {
  rootPath,
  rootName,
  filter,
  selectedPath,
  flatTree,
  recentFolders,
  clipboard,
} = storeToRefs(workspace);

const menu = ref<{ x: number; y: number; path: string; isDir: boolean } | null>(
  null,
);

const dirtySet = computed(() => editor.dirtyPaths);

onMounted(() => {
  if (rootPath.value) void git.refresh();
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
    workspace.revealPath(path);
  }
}
</script>

<template>
  <div class="panel" @click="closeMenu">
    <header class="header">
      <span class="title">资源管理器</span>
      <button v-if="rootPath" type="button" class="icon-btn" title="更多" @click.stop="onOpen">
        <MoreHorizontal :size="16" />
      </button>
    </header>

    <div v-if="rootPath" class="toolbar">
      <input
        v-model="filter"
        class="ui-input filter"
        type="search"
        placeholder="过滤文件…"
      />
    </div>

    <div class="body">
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
          class="root-label"
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
      <button type="button" @click="runMenu('reveal')">在资源管理器中显示</button>
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
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.toolbar {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.filter {
  width: 100%;
  height: 30px;
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
