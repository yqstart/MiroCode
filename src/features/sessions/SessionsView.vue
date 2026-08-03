<script setup lang="ts">
import { HardDrive, LayoutGrid, Plus, Server, TerminalSquare, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import LocalTerminal from "@/features/sessions/LocalTerminal.vue";
import PackageScriptsMenu from "@/features/sessions/PackageScriptsMenu.vue";
import RemoteTerminal from "@/features/sessions/RemoteTerminal.vue";
import SftpPanel from "@/features/sessions/SftpPanel.vue";
import SshHostsView from "@/features/sessions/SshHostsView.vue";
import {
  parseHostKeyUnknown,
  sftpClose,
  sftpOpen,
  type SshConnectConfig,
} from "@/shared/sshApi";
import {
  sftpSessionId,
  useSessionsStore,
  type SessionSubView,
} from "@/stores/sessions";
import { usePackageScriptsStore } from "@/stores/packageScripts";
import { useWorkspaceStore } from "@/stores/workspace";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const pkg = usePackageScriptsStore();
const {
  subView,
  localTerminals,
  activeLocalId,
  remoteSessions,
  activeRemoteId,
} = storeToRefs(sessions);
const { available: hasScripts } = storeToRefs(pkg);

const remoteConnecting = ref(false);
const remoteError = ref("");
/** SSH 区：主机列表 / 已连接会话 */
const sshSurface = ref<"hosts" | "session">("hosts");
const sftpBusy = ref(false);
const sftpError = ref("");

const navItems = computed(() => [
  { id: "local" as SessionSubView, label: t("sessions.local") },
  { id: "remote" as SessionSubView, label: t("sessions.remote") },
]);

const activeRemote = computed(() =>
  remoteSessions.value.find((t) => t.id === activeRemoteId.value) ?? null,
);

const showHosts = computed(
  () => sshSurface.value === "hosts" || !remoteSessions.value.length,
);

function onAddLocal() {
  sessions.addLocalTerminal(workspace.rootPath);
}

function goHosts() {
  sshSurface.value = "hosts";
  remoteError.value = "";
  sftpError.value = "";
}

function onRemoteConnect(config: SshConnectConfig) {
  remoteConnecting.value = true;
  remoteError.value = "";
  sessions.addRemoteSession(config);
  sshSurface.value = "session";
  remoteConnecting.value = false;
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
      remoteError.value = t("sessions.hostKeyRejected");
      sshSurface.value = "hosts";
    }
    return;
  }

  // 先切回主机列表并保留错误；close 触发的 watch 不得清掉本条错误
  remoteError.value = message;
  sshSurface.value = "hosts";
  void closeRemoteFully(id, { keepError: true });
}

function onRemoteClosed(id: string) {
  void closeRemoteFully(id);
}

async function closeRemoteFully(
  id: string,
  opts: { keepError?: boolean } = {},
) {
  const session = remoteSessions.value.find((t) => t.id === id);
  if (session?.sftpOpened) {
    try {
      await sftpClose(sftpSessionId(id));
    } catch {
      // 忽略已断开
    }
  }
  sessions.closeRemoteSession(id);
  if (!remoteSessions.value.length) {
    sshSurface.value = "hosts";
    if (!opts.keepError) {
      remoteError.value = "";
      sftpError.value = "";
    }
  }
}

function activateRemoteSession(id: string) {
  sshSurface.value = "session";
  sessions.activateRemote(id);
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

function onSelectNav(id: SessionSubView) {
  sessions.setSubView(id);
  if (id === "remote" && !remoteSessions.value.length) {
    sshSurface.value = "hosts";
  }
  if (id === "local") {
    void pkg.refresh();
  }
}

watch(
  () => workspace.rootPath,
  () => {
    void pkg.refresh(true);
  },
  { immediate: true },
);

watch(remoteSessions, (list) => {
  if (!list.length) {
    sshSurface.value = "hosts";
  }
});
</script>

<template>
  <div class="sessions">
    <aside class="rail" :aria-label="t('sessions.sessionType')">
      <button
        v-for="item in navItems"
        :key="item.id"
        type="button"
        class="rail-item"
        :class="{ active: subView === item.id }"
        @click="onSelectNav(item.id)"
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
              :title="t('sessions.closeTerminal')"
              @click.stop="sessions.closeLocalTerminal(term.id)"
            >
              <X :size="12" />
            </span>
          </button>
          <button
            type="button"
            class="add"
            :title="t('sessions.newLocalTitle')"
            @click="onAddLocal"
          >
            <Plus :size="14" />
          </button>
          <div v-if="hasScripts" class="scripts-slot">
            <PackageScriptsMenu variant="compact" />
          </div>
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
            <p>{{ t("sessions.localEmpty") }}</p>
            <button type="button" class="cta" @click="onAddLocal">
              {{ t("sessions.newTerminal") }}
            </button>
          </div>
        </div>
      </template>

      <!-- SSH（主机列表 + 会话） -->
      <template v-else>
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
            :class="{ active: activeRemote.pane === 'shell' }"
            @click="switchRemotePane('shell')"
          >
            <TerminalSquare :size="13" />
            {{ t("sessions.shell") }}
          </button>
          <button
            type="button"
            class="pane-btn"
            :class="{ active: activeRemote.pane === 'sftp' }"
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
            v-if="showHosts"
            :connecting="remoteConnecting"
            :error="remoteError"
            @connect="onRemoteConnect"
          />
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
  min-width: 0;
}

.scripts-slot {
  flex: 1;
  min-width: 0;
  margin-left: 4px;
  display: flex;
  justify-content: flex-end;
  overflow: hidden;
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
