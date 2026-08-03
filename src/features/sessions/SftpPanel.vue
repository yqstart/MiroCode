<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Folder,
  RefreshCw,
  Upload,
} from "lucide-vue-next";
import { useI18n } from "@/i18n";
import {
  sftpClose,
  sftpCreateFile,
  sftpList,
  sftpMkdir,
  sftpPwd,
  sftpRemove,
  sftpRename,
  sftpUpload,
  type SftpEntry,
  type SshConnectConfig,
} from "@/shared/sshApi";
import FileTypeIcon from "@/shared/FileTypeIcon.vue";
import { basename } from "@/shared/fs";
import { promptInput } from "@/shared/promptDialog";

const props = defineProps<{
  sessionId: string;
  config: SshConnectConfig;
}>();

const emit = defineEmits<{
  failed: [message: string];
  disconnected: [];
}>();

const { t } = useI18n();
const cwd = ref("/");
const entries = ref<SftpEntry[]>([]);
const loading = ref(false);
const uploading = ref(false);
const notice = ref("");
const error = ref("");
const selectedPath = ref<string | null>(null);

type MenuState = {
  x: number;
  y: number;
  /** 右键空白处时为当前目录；右键条目时为该路径 */
  path: string;
  isDir: boolean;
  /** 针对条目还是空白/当前目录 */
  onEntry: boolean;
};

const menu = ref<MenuState | null>(null);

const parentPath = computed(() => {
  if (!cwd.value || cwd.value === "/") return null;
  const trimmed = cwd.value.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx) || "/";
});

function joinRemote(parent: string, name: string) {
  if (parent === "/" || !parent) return `/${name}`;
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

/** 拒绝路径穿越与多段名 */
function assertSafeBaseName(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new Error(t("sftp.invalidName"));
  }
  return trimmed;
}

function flash(msg: string) {
  notice.value = msg;
  window.setTimeout(() => {
    if (notice.value === msg) notice.value = "";
  }, 2400);
}

function formatSize(size: number, isDir: boolean) {
  if (isDir) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function closeMenu() {
  menu.value = null;
}

async function loadDir(path: string) {
  loading.value = true;
  error.value = "";
  closeMenu();
  try {
    const list = await sftpList(props.sessionId, path);
    entries.value = list;
    cwd.value = path === "." ? await sftpPwd(props.sessionId) : path;
    if (selectedPath.value && !list.some((e) => e.path === selectedPath.value)) {
      selectedPath.value = null;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function selectEntry(entry: SftpEntry) {
  selectedPath.value = entry.path;
}

async function openEntry(entry: SftpEntry) {
  if (!entry.isDir) {
    selectedPath.value = entry.path;
    return;
  }
  selectedPath.value = null;
  await loadDir(entry.path);
}

async function goParent() {
  if (!parentPath.value) return;
  selectedPath.value = null;
  await loadDir(parentPath.value);
}

function onContextBlank(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const menuWidth = 180;
  const menuHeight = 200;
  const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
  const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
  menu.value = {
    x: Math.max(8, x),
    y: Math.max(8, y),
    path: cwd.value,
    isDir: true,
    onEntry: false,
  };
}

function onContextEntry(event: MouseEvent, entry: SftpEntry) {
  event.preventDefault();
  event.stopPropagation();
  selectedPath.value = entry.path;
  const menuWidth = 180;
  const menuHeight = 220;
  const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
  const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
  menu.value = {
    x: Math.max(8, x),
    y: Math.max(8, y),
    path: entry.path,
    isDir: entry.isDir,
    onEntry: true,
  };
}

async function runMenu(action: string) {
  if (!menu.value) return;
  const { path, isDir, onEntry } = menu.value;
  const parent = onEntry && !isDir ? path.replace(/\/[^/]+$/, "") || "/" : path;
  const createParent = onEntry && isDir ? path : onEntry ? parent : cwd.value;
  closeMenu();

  try {
    if (action === "refresh") {
      await loadDir(cwd.value);
      return;
    }
    if (action === "new-file") {
      const name = await promptInput({
        title: t("sftp.newFileTitle"),
        label: t("sftp.namePrompt"),
        placeholder: "file.txt",
      });
      if (!name?.trim()) return;
      const safe = assertSafeBaseName(name);
      const remote = joinRemote(createParent, safe);
      await sftpCreateFile(props.sessionId, remote);
      flash(t("sftp.created", { name: safe }));
      await loadDir(cwd.value);
      return;
    }
    if (action === "new-folder") {
      const name = await promptInput({
        title: t("sftp.newFolderTitle"),
        label: t("sftp.namePrompt"),
        placeholder: "folder",
      });
      if (!name?.trim()) return;
      const safe = assertSafeBaseName(name);
      const remote = joinRemote(createParent, safe);
      await sftpMkdir(props.sessionId, remote);
      flash(t("sftp.created", { name: safe }));
      await loadDir(cwd.value);
      return;
    }
    if (action === "rename" && onEntry) {
      const oldName = basename(path);
      const name = await promptInput({
        title: t("sftp.renameTitle"),
        label: t("sftp.namePrompt"),
        defaultValue: oldName,
      });
      if (!name?.trim() || name.trim() === oldName) return;
      const safe = assertSafeBaseName(name);
      const destParent = path.replace(/\/[^/]+$/, "") || "/";
      const to = joinRemote(destParent, safe);
      await sftpRename(props.sessionId, path, to);
      flash(t("sftp.renamed"));
      selectedPath.value = to;
      await loadDir(cwd.value);
      return;
    }
    if (action === "delete" && onEntry) {
      const name = basename(path);
      if (!window.confirm(t("sftp.deleteConfirm", { name }))) return;
      await sftpRemove(props.sessionId, path);
      flash(t("sftp.deleted", { name }));
      selectedPath.value = null;
      await loadDir(cwd.value);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function onUpload() {
  const selected = await open({
    multiple: true,
    title: t("sftp.selectUpload"),
  });
  if (!selected) return;
  const files = Array.isArray(selected) ? selected : [selected];
  uploading.value = true;
  error.value = "";
  let ok = 0;
  try {
    for (const local of files) {
      const name = basename(local);
      const remote =
        cwd.value === "/" ? `/${name}` : `${cwd.value.replace(/\/+$/, "")}/${name}`;
      await sftpUpload(props.sessionId, local, remote);
      ok += 1;
    }
    flash(t("sftp.uploaded", { count: ok }));
    await loadDir(cwd.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    uploading.value = false;
  }
}

async function onDisconnect() {
  await sftpClose(props.sessionId);
  emit("disconnected");
}

function onDocClick() {
  closeMenu();
}

onMounted(async () => {
  document.addEventListener("click", onDocClick);
  try {
    const pwd = await sftpPwd(props.sessionId);
    await loadDir(pwd || "/");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    emit("failed", message);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  void sftpClose(props.sessionId);
});
</script>

<template>
  <div class="sftp" @contextmenu="onContextBlank">
    <header class="toolbar">
      <div class="path" :title="cwd">{{ cwd }}</div>
      <div class="actions">
        <button
          type="button"
          class="icon-btn"
          :title="t('sftp.parentDir')"
          :disabled="!parentPath || loading"
          @click="goParent"
        >
          <ArrowUp :size="15" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :title="t('sftp.refresh')"
          :disabled="loading"
          @click="loadDir(cwd)"
        >
          <RefreshCw :size="15" :class="{ spin: loading }" />
        </button>
        <button
          type="button"
          class="cta"
          :disabled="uploading"
          @click="onUpload"
        >
          <Upload :size="14" />
          {{ uploading ? t("sftp.uploading") : t("sftp.upload") }}
        </button>
        <button type="button" class="ghost" @click="onDisconnect">{{ t("sftp.disconnect") }}</button>
      </div>
    </header>

    <p v-if="notice" class="notice">{{ notice }}</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="list">
      <button
        v-if="parentPath"
        type="button"
        class="row"
        @click="goParent"
      >
        <Folder :size="14" class="folder" />
        <span class="name">..</span>
        <span class="meta">{{ t("sftp.parent") }}</span>
      </button>
      <button
        v-for="entry in entries"
        :key="entry.path"
        type="button"
        class="row"
        :class="{ selected: selectedPath === entry.path }"
        :title="entry.path"
        @click="selectEntry(entry)"
        @dblclick="openEntry(entry)"
        @contextmenu="onContextEntry($event, entry)"
      >
        <FileTypeIcon
          :path="entry.path"
          :is-dir="entry.isDir"
          :size="14"
        />
        <span class="name">{{ entry.name }}</span>
        <span class="meta">{{ formatSize(entry.size, entry.isDir) }}</span>
      </button>
      <div v-if="!loading && !entries.length" class="empty">{{ t("sftp.empty") }}</div>
    </div>

    <footer class="footer">
      {{
        t("sftp.itemCount", {
          user: config.username,
          host: config.host,
          count: entries.length,
        })
      }}
    </footer>

    <div
      v-if="menu"
      class="menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <button type="button" @click="runMenu('new-file')">
        {{ t("sftp.newFile") }}
      </button>
      <button type="button" @click="runMenu('new-folder')">
        {{ t("sftp.newFolder") }}
      </button>
      <template v-if="menu.onEntry">
        <hr />
        <button type="button" @click="runMenu('rename')">
          {{ t("sftp.rename") }}
        </button>
        <button type="button" class="danger" @click="runMenu('delete')">
          {{ t("sftp.delete") }}
        </button>
      </template>
      <hr />
      <button type="button" @click="runMenu('refresh')">
        {{ t("sftp.refreshMenu") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sftp {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.path {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.icon-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.icon-btn:disabled {
  opacity: 0.35;
}

.cta,
.ghost {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cta {
  background: var(--accent);
  color: var(--accent-fg);
}

.cta:disabled {
  opacity: 0.5;
}

.ghost {
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.ghost:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.notice {
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--accent);
}

.error {
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--danger);
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

.row {
  width: 100%;
  min-height: 30px;
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 6px;
  text-align: left;
  color: var(--text-primary);
}

.row:hover {
  background: var(--accent-soft);
}

.row.selected {
  background: var(--accent-soft);
  outline: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}

.folder {
  color: var(--accent);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}

.meta {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.footer {
  padding: 6px 12px;
  border-top: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--text-muted);
}

.menu {
  position: fixed;
  z-index: 80;
  min-width: 160px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.menu button {
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text-primary);
}

.menu button:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.menu button.danger:hover {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.menu hr {
  margin: 4px 6px;
  border: none;
  border-top: 1px solid var(--border-subtle);
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
