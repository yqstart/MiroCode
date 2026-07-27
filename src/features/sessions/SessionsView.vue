<script setup lang="ts">
import { HardDrive, Plus, Server, TerminalSquare, X } from "lucide-vue-next";
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import LocalTerminal from "@/features/sessions/LocalTerminal.vue";
import RemoteTerminal from "@/features/sessions/RemoteTerminal.vue";
import SftpPanel from "@/features/sessions/SftpPanel.vue";
import SshConnectForm from "@/features/sessions/SshConnectForm.vue";
import { sftpClose, sftpOpen, type SshConnectConfig } from "@/shared/sshApi";
import {
  sftpSessionId,
  useSessionsStore,
  type SessionSubView,
} from "@/stores/sessions";
import { useWorkspaceStore } from "@/stores/workspace";

const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const {
  subView,
  localTerminals,
  activeLocalId,
  remoteSessions,
  activeRemoteId,
} = storeToRefs(sessions);

const remoteConnecting = ref(false);
const remoteError = ref("");
const showRemoteForm = ref(false);
const sftpBusy = ref(false);
const sftpError = ref("");

const navItems: { id: SessionSubView; label: string }[] = [
  { id: "local", label: "本地终端" },
  { id: "remote", label: "远程 SSH" },
];

const activeRemote = computed(() =>
  remoteSessions.value.find((t) => t.id === activeRemoteId.value) ?? null,
);

function onAddLocal() {
  sessions.addLocalTerminal(workspace.rootPath);
}

function onAddRemote() {
  showRemoteForm.value = true;
  remoteError.value = "";
  sftpError.value = "";
}

function onRemoteConnect(config: SshConnectConfig) {
  remoteConnecting.value = true;
  remoteError.value = "";
  sessions.addRemoteSession(config);
  showRemoteForm.value = false;
  remoteConnecting.value = false;
}

function onRemoteFailed(id: string, message: string) {
  remoteError.value = message;
  void closeRemoteFully(id);
  showRemoteForm.value = true;
}

function onRemoteClosed(id: string) {
  void closeRemoteFully(id);
}

async function closeRemoteFully(id: string) {
  const session = remoteSessions.value.find((t) => t.id === id);
  if (session?.sftpOpened) {
    try {
      await sftpClose(sftpSessionId(id));
    } catch {
      // 忽略已断开
    }
  }
  sessions.closeRemoteSession(id);
}

async function switchRemotePane(pane: "shell" | "sftp") {
  const session = activeRemote.value;
  if (!session) return;
  sftpError.value = "";
  if (pane === "shell") {
    sessions.setRemotePane(session.id, "shell");
    return;
  }
  if (session.sftpOpened) {
    sessions.setRemotePane(session.id, "sftp");
    return;
  }
  sftpBusy.value = true;
  try {
    await sftpOpen(sftpSessionId(session.id), session.config);
    sessions.markSftpOpened(session.id, true);
  } catch (e) {
    sftpError.value = e instanceof Error ? e.message : String(e);
  } finally {
    sftpBusy.value = false;
  }
}

function onSftpFailed(id: string, message: string) {
  sftpError.value = message;
  sessions.markSftpOpened(id, false);
  sessions.setRemotePane(id, "shell");
}

function onSftpDisconnected(id: string) {
  sessions.markSftpOpened(id, false);
  sessions.setRemotePane(id, "shell");
}
</script>

<template>
  <div class="sessions">
    <aside class="rail" aria-label="会话类型">
      <button
        v-for="item in navItems"
        :key="item.id"
        type="button"
        class="rail-item"
        :class="{ active: subView === item.id }"
        @click="sessions.setSubView(item.id)"
      >
        <TerminalSquare v-if="item.id === 'local'" :size="16" />
        <Server v-else :size="16" />
        <span>{{ item.label }}</span>
      </button>
    </aside>

    <section class="main">
      <!-- 本地 -->
      <template v-if="subView === 'local'">
        <header class="subtabs">
          <button
            v-for="term in localTerminals"
            :key="term.id"
            type="button"
            class="subtab"
            :class="{ active: term.id === activeLocalId }"
            @click="sessions.activateLocal(term.id)"
          >
            <span>{{ term.title }}</span>
            <span
              class="close"
              title="关闭终端"
              @click.stop="sessions.closeLocalTerminal(term.id)"
            >
              <X :size="12" />
            </span>
          </button>
          <button type="button" class="add" title="新建本地终端" @click="onAddLocal">
            <Plus :size="14" />
          </button>
        </header>
        <div class="body">
          <LocalTerminal
            v-for="term in localTerminals"
            v-show="term.id === activeLocalId"
            :key="term.id"
            :session-id="term.id"
            :cwd="term.cwd"
            :active="term.id === activeLocalId"
          />
          <div v-if="!localTerminals.length" class="empty">
            <p>暂无本地终端</p>
            <button type="button" class="cta" @click="onAddLocal">新建终端</button>
          </div>
        </div>
      </template>

      <!-- 远程 SSH（含 SFTP） -->
      <template v-else>
        <header class="subtabs">
          <button
            v-for="term in remoteSessions"
            :key="term.id"
            type="button"
            class="subtab"
            :class="{ active: term.id === activeRemoteId && !showRemoteForm }"
            @click="showRemoteForm = false; sessions.activateRemote(term.id)"
          >
            <span>{{ term.title }}</span>
            <span
              class="close"
              title="关闭"
              @click.stop="closeRemoteFully(term.id)"
            >
              <X :size="12" />
            </span>
          </button>
          <button type="button" class="add" title="新建 SSH 连接" @click="onAddRemote">
            <Plus :size="14" />
          </button>
        </header>

        <div
          v-if="activeRemote && !showRemoteForm"
          class="pane-switch"
        >
          <button
            type="button"
            class="pane-btn"
            :class="{ active: activeRemote.pane === 'shell' }"
            @click="switchRemotePane('shell')"
          >
            <TerminalSquare :size="13" />
            终端
          </button>
          <button
            type="button"
            class="pane-btn"
            :class="{ active: activeRemote.pane === 'sftp' }"
            :disabled="sftpBusy"
            @click="switchRemotePane('sftp')"
          >
            <HardDrive :size="13" />
            {{ sftpBusy ? "连接中…" : "SFTP" }}
          </button>
          <p v-if="sftpError" class="pane-error">{{ sftpError }}</p>
        </div>

        <div class="body">
          <div
            v-if="showRemoteForm || !remoteSessions.length"
            class="form-wrap"
          >
            <SshConnectForm
              title="连接远程 SSH"
              :connecting="remoteConnecting"
              :error="remoteError"
              @connect="onRemoteConnect"
            />
          </div>
          <template v-else>
            <template v-for="term in remoteSessions" :key="term.id">
              <RemoteTerminal
                v-show="term.id === activeRemoteId && term.pane === 'shell'"
                :session-id="term.id"
                :config="term.config"
                :active="term.id === activeRemoteId && term.pane === 'shell'"
                @failed="onRemoteFailed(term.id, $event)"
                @closed="onRemoteClosed(term.id)"
              />
              <SftpPanel
                v-if="term.sftpOpened"
                v-show="term.id === activeRemoteId && term.pane === 'sftp'"
                :session-id="sftpSessionId(term.id)"
                :config="term.config"
                @failed="onSftpFailed(term.id, $event)"
                @disconnected="onSftpDisconnected(term.id)"
              />
            </template>
          </template>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.sessions {
  height: 100%;
  display: grid;
  grid-template-columns: 148px 1fr;
  min-height: 0;
  background: var(--bg-app);
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 8px;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.rail-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-align: left;
}

.rail-item span {
  font-size: 12px;
  font-weight: 600;
}

.rail-item:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.rail-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.subtabs {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.subtab {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.subtab:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.subtab.active {
  color: var(--accent);
  background: var(--accent-soft);
}

.subtab .close {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  opacity: 0.55;
}

.subtab .close:hover {
  opacity: 1;
  background: var(--bg-app);
}

.add {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.add:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.pane-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.pane-btn {
  height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.pane-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--accent-soft);
}

.pane-btn.active {
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 600;
}

.pane-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.pane-error {
  margin: 0 0 0 auto;
  font-size: 11px;
  color: var(--danger);
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.form-wrap,
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-secondary);
  text-align: center;
  padding: 24px;
  overflow: auto;
}

.cta {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
</style>
