import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { SshConnectConfig } from "@/shared/sshApi";

export type SessionSubView = "local" | "remote";
export type RemotePane = "shell" | "sftp";

export interface LocalTerminalSession {
  id: string;
  title: string;
  cwd: string | null;
}

/** SSH 远程会话：终端与 SFTP 共用同一连接配置 */
export interface RemoteSession {
  id: string;
  title: string;
  config: SshConnectConfig;
  pane: RemotePane;
  sftpOpened: boolean;
}

const SESSIONS_TAB_ID = "miro://sessions";

export function sftpSessionId(remoteId: string): string {
  return `sftp-${remoteId}`;
}

export const useSessionsStore = defineStore("sessions", () => {
  const open = ref(false);
  const focused = ref(false);
  const subView = ref<SessionSubView>("local");
  const localTerminals = ref<LocalTerminalSession[]>([]);
  const activeLocalId = ref<string | null>(null);
  const remoteSessions = ref<RemoteSession[]>([]);
  const activeRemoteId = ref<string | null>(null);
  let seq = 0;

  const tabId = SESSIONS_TAB_ID;
  const isFocused = computed(() => open.value && focused.value);

  function ensureDefaultLocal(cwd: string | null) {
    if (localTerminals.value.length > 0) return;
    seq += 1;
    const id = `local-${seq}`;
    localTerminals.value.push({
      id,
      title: "终端 1",
      cwd,
    });
    activeLocalId.value = id;
  }

  function openSessions(cwd: string | null = null) {
    open.value = true;
    focused.value = true;
    subView.value = "local";
    ensureDefaultLocal(cwd);
  }

  function focusSessions() {
    if (!open.value) return;
    focused.value = true;
    void import("@/stores/compare").then(({ useCompareStore }) => {
      useCompareStore().blurCompare();
    });
  }

  function blurSessions() {
    focused.value = false;
  }

  function closeSessions() {
    open.value = false;
    focused.value = false;
  }

  function setSubView(view: SessionSubView) {
    subView.value = view;
    open.value = true;
    focused.value = true;
  }

  function addLocalTerminal(cwd: string | null = null) {
    seq += 1;
    const id = `local-${seq}`;
    const index = localTerminals.value.length + 1;
    localTerminals.value.push({
      id,
      title: `终端 ${index}`,
      cwd,
    });
    activeLocalId.value = id;
    subView.value = "local";
    openSessions(cwd);
  }

  function closeLocalTerminal(id: string) {
    const idx = localTerminals.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    localTerminals.value.splice(idx, 1);
    if (activeLocalId.value === id) {
      const next = localTerminals.value[idx] || localTerminals.value[idx - 1] || null;
      activeLocalId.value = next?.id ?? null;
    }
    if (localTerminals.value.length === 0 && remoteSessions.value.length === 0) {
      closeSessions();
    }
  }

  function activateLocal(id: string) {
    activeLocalId.value = id;
    subView.value = "local";
    focusSessions();
  }

  function addRemoteSession(config: SshConnectConfig) {
    seq += 1;
    const id = `ssh-${seq}`;
    const title = `${config.username}@${config.host}`;
    remoteSessions.value.push({
      id,
      title,
      config,
      pane: "shell",
      sftpOpened: false,
    });
    activeRemoteId.value = id;
    subView.value = "remote";
    open.value = true;
    focused.value = true;
    return id;
  }

  function closeRemoteSession(id: string) {
    const idx = remoteSessions.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    remoteSessions.value.splice(idx, 1);
    if (activeRemoteId.value === id) {
      const next =
        remoteSessions.value[idx] || remoteSessions.value[idx - 1] || null;
      activeRemoteId.value = next?.id ?? null;
    }
    if (localTerminals.value.length === 0 && remoteSessions.value.length === 0) {
      closeSessions();
    }
  }

  function activateRemote(id: string) {
    activeRemoteId.value = id;
    subView.value = "remote";
    focusSessions();
  }

  function setRemotePane(id: string, pane: RemotePane) {
    const session = remoteSessions.value.find((t) => t.id === id);
    if (!session) return;
    session.pane = pane;
  }

  function markSftpOpened(id: string, opened = true) {
    const session = remoteSessions.value.find((t) => t.id === id);
    if (!session) return;
    session.sftpOpened = opened;
    if (opened) session.pane = "sftp";
  }

  // 兼容旧命名
  const addRemoteTerminal = addRemoteSession;
  const closeRemoteTerminal = closeRemoteSession;

  return {
    tabId,
    open,
    focused,
    isFocused,
    subView,
    localTerminals,
    activeLocalId,
    remoteSessions,
    activeRemoteId,
    /** @deprecated 使用 remoteSessions */
    remoteTerminals: remoteSessions,
    openSessions,
    focusSessions,
    blurSessions,
    closeSessions,
    setSubView,
    addLocalTerminal,
    closeLocalTerminal,
    activateLocal,
    addRemoteSession,
    closeRemoteSession,
    activateRemote,
    setRemotePane,
    markSftpOpened,
    addRemoteTerminal,
    closeRemoteTerminal,
  };
});
