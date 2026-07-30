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
  sftpList,
  sftpPwd,
  sftpUpload,
  type SftpEntry,
  type SshConnectConfig,
} from "@/shared/sshApi";
import FileTypeIcon from "@/shared/FileTypeIcon.vue";
import { basename } from "@/shared/fs";

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

const parentPath = computed(() => {
  if (!cwd.value || cwd.value === "/") return null;
  const trimmed = cwd.value.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx) || "/";
});

function formatSize(size: number, isDir: boolean) {
  if (isDir) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadDir(path: string) {
  loading.value = true;
  error.value = "";
  try {
    const list = await sftpList(props.sessionId, path);
    entries.value = list;
    cwd.value = path === "." ? await sftpPwd(props.sessionId) : path;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function openEntry(entry: SftpEntry) {
  if (!entry.isDir) return;
  await loadDir(entry.path);
}

async function goParent() {
  if (!parentPath.value) return;
  await loadDir(parentPath.value);
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
    notice.value = t("sftp.uploaded", { count: ok });
    window.setTimeout(() => {
      notice.value = "";
    }, 2400);
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

onMounted(async () => {
  try {
    const pwd = await sftpPwd(props.sessionId);
    await loadDir(pwd || "/");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    emit("failed", message);
  }
});

onBeforeUnmount(() => {
  void sftpClose(props.sessionId);
});
</script>

<template>
  <div class="sftp">
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
        :title="entry.path"
        @click="openEntry(entry)"
        @dblclick="openEntry(entry)"
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
  </div>
</template>

<style scoped>
.sftp {
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

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
