<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { HardDrive, LayoutGrid, TerminalSquare, X } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import RemoteTerminal from "@/features/sessions/RemoteTerminal.vue";
import SftpPanel from "@/features/sessions/SftpPanel.vue";
import SshHostsView from "@/features/sessions/SshHostsView.vue";
import {
  parseHostKeyUnknown,
  sftpOpen,
  type SshConnectConfig,
} from "@/shared/sshApi";
import { sftpSessionId, useSshStore } from "@/stores/ssh";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const ssh = useSshStore();
const { surface, remoteSessions, activeRemoteId } = storeToRefs(ssh);

const connecting = ref(false);
const error = ref("");
const sftpBusy = ref(false);
const sftpError = ref("");

const activeRemote = computed(() =>
  remoteSessions.value.find((t) => t.id === activeRemoteId.value) ?? null,
);

const showHosts = computed(
  () => surface.value === "hosts" || !remoteSessions.value.length,
);

function goHosts() {
  ssh.goHosts();
  error.value = "";
  sftpError.value = "";
}

function onRemoteConnect(config: SshConnectConfig) {
  connecting.value = true;
  error.value = "";
  void ssh.addRemoteSession(config).finally(() => {
    connecting.value = false;
  });
}

function onRemoteFailed(id: string, message: string) {
  const session = remoteSessions.value.find((t) => t.id === id);
  const unknown = parseHostKeyUnknown(message);
  if (unknown && session) {
    const ok = window.confirm(
      t("sessions.hostKeyUnknownConfirm", {
        endpoint: unknown.endpoint,
        fingerprint: unknown.fingerprint,
      }),
    );
    const config = { ...session.config };
    void closeRemoteFully(id, { keepError: false });
    if (ok) {
      onRemoteConnect({ ...config, acceptUnknownHostKey: true });
    } else {
      error.value = t("sessions.hostKeyRejected");
      ssh.goHosts();
    }
    return;
  }

  // 先切回主机列表并保留错误；close 触发的 watch 不得清掉本条错误
  error.value = message;
  ssh.goHosts();
  void closeRemoteFully(id, { keepError: true });
}

function onRemoteClosed(id: string) {
  void closeRemoteFully(id);
}

async function closeRemoteFully(
  id: string,
  opts: { keepError?: boolean } = {},
) {
  const ok = await ssh.closeRemoteSession(id);
  if (!ok) return;
  if (!remoteSessions.value.length && !opts.keepError) {
    error.value = "";
    sftpError.value = "";
  }
}

function activateRemoteSession(id: string) {
  ssh.activateRemote(id);
}

async function switchRemotePane(pane: "shell" | "sftp") {
  const session = activeRemote.value;
  if (!session) return;
  sftpError.value = "";
  if (pane === "shell") {
    ssh.setRemotePane(session.id, "shell");
    return;
  }
  if (session.sftpOpened) {
    ssh.setRemotePane(session.id, "sftp");
    return;
  }
  sftpBusy.value = true;
  try {
    await sftpOpen(sftpSessionId(session.id), session.config);
    ssh.markSftpOpened(session.id, true);
  } catch (e) {
    sftpError.value = e instanceof Error ? e.message : String(e);
  } finally {
    sftpBusy.value = false;
  }
}

function onSftpFailed(id: string, message: string) {
  sftpError.value = message;
  ssh.markSftpOpened(id, false);
  ssh.setRemotePane(id, "shell");
}

function onSftpDisconnected(id: string) {
  ssh.markSftpOpened(id, false);
  ssh.setRemotePane(id, "shell");
}

watch(remoteSessions, (list) => {
  if (!list.length) {
    ssh.goHosts();
  }
});
</script>

<template>
  <div class="ssh-view">
    <!-- SSH 会话顶栏 -->
    <header v-if="remoteSessions.length" class="subtabs">
      <button
        type="button"
        class="subtab"
        :class="{ active: showHosts }"
        :title="t('sessions.hostsList')"
        @click="goHosts"
      >
        <LayoutGrid :size="12" />
        <span>{{ t("sessions.hosts") }}</span>
      </button>
      <button
        v-for="term in remoteSessions"
        :key="term.id"
        type="button"
        class="subtab"
        :class="{ active: !showHosts && term.id === activeRemoteId }"
        @click="activateRemoteSession(term.id)"
      >
        <span>{{ term.title }}</span>
        <span
          class="close"
          :title="t('common.close')"
          @click.stop="closeRemoteFully(term.id)"
        >
          <X :size="12" />
        </span>
      </button>
    </header>

    <div
      v-if="!showHosts && activeRemote"
      class="pane-switch"
    >
      <button
        type="button"
        class="pane-btn"
        :class="{ active: activeRemote?.pane === 'shell' }"
        @click="switchRemotePane('shell')"
      >
        <TerminalSquare :size="13" />
        {{ t("sessions.shell") }}
      </button>
      <button
        type="button"
        class="pane-btn"
        :class="{ active: activeRemote?.pane === 'sftp' }"
        :disabled="sftpBusy"
        @click="switchRemotePane('sftp')"
      >
        <HardDrive :size="13" />
        {{ sftpBusy ? t("sessions.connecting") : t("sessions.sftp") }}
      </button>
      <p v-if="sftpError" class="pane-error">{{ sftpError }}</p>
    </div>

    <div class="body">
      <SshHostsView
        v-show="showHosts"
        :connecting="connecting"
        :error="error"
        @connect="onRemoteConnect"
      />

      <!-- 远程会话 -->
      <template v-for="term in remoteSessions" :key="term.id">
        <RemoteTerminal
          v-show="
            !showHosts &&
            term.id === activeRemoteId &&
            term.pane === 'shell'
          "
          :session-id="term.id"
          :config="term.config"
          :active="
            !showHosts &&
            term.id === activeRemoteId &&
            term.pane === 'shell'
          "
          @failed="onRemoteFailed(term.id, $event)"
          @closed="onRemoteClosed(term.id)"
        />
        <SftpPanel
          v-if="term.sftpOpened"
          v-show="
            !showHosts &&
            term.id === activeRemoteId &&
            term.pane === 'sftp'
          "
          :session-id="sftpSessionId(term.id)"
          :config="term.config"
          @failed="onSftpFailed(term.id, $event)"
          @disconnected="onSftpDisconnected(term.id)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.ssh-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-app);
}

.subtabs {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  min-width: 0;
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
</style>
