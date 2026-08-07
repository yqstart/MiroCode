import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { sftpClose, sshShellClose, type SshConnectConfig } from "@/shared/sshApi";

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
  /** 终端标签是否出现在编辑区标签栏 */
  const open = ref(false);
  const focused = ref(false);
  /**
   * 快捷键隐藏后会话仍存活：视图保持挂载、PTY 不销毁，
   * 与关闭标签（卸载并结束进程）区分。
   */
  const dormant = ref(false);
  const subView = ref<SessionSubView>("local");
  const localTerminals = ref<LocalTerminalSession[]>([]);
  const activeLocalId = ref<string | null>(null);
  const remoteSessions = ref<RemoteSession[]>([]);
  const activeRemoteId = ref<string | null>(null);
  /** 注入到本地 PTY 的待发送输入 */
  const pendingLocalWrite = ref<{
    terminalId: string;
    data: string;
    seq: number;
  } | null>(null);
  let seq = 0;
  let writeSeq = 0;

  const tabId = SESSIONS_TAB_ID;
  const isFocused = computed(() => open.value && focused.value);
  /** 是否应挂载 SessionsView（显示中或快捷键隐藏保活） */
  const mounted = computed(
    () => open.value || dormant.value,
  );

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

  function hasAnySession() {
    return localTerminals.value.length > 0 || remoteSessions.value.length > 0;
  }

  function openSessions(cwd: string | null = null) {
    const restoring = dormant.value;
    dormant.value = false;
    open.value = true;
    focused.value = true;
    // 从隐藏恢复时保留本地/SSH 子视图；首次打开默认本地终端
    if (!restoring) {
      subView.value = "local";
    }
    ensureDefaultLocal(cwd);
    void import("@/stores/compare").then(({ useCompareStore }) => {
      useCompareStore().blurCompare();
    });
    void import("@/stores/gitLog").then(({ useGitLogStore }) => {
      useGitLogStore().blurLog();
    });
  }

  /** 隐藏终端标签但保留会话与 PTY（⌘/Ctrl+J） */
  function hideSessions() {
    if (!open.value) return;
    open.value = false;
    focused.value = false;
    dormant.value = hasAnySession();
  }

  /** 显示 ↔ 隐藏切换；关闭标签请用 closeSessions */
  function toggleSessions(cwd: string | null = null) {
    if (open.value) {
      hideSessions();
      return;
    }
    openSessions(cwd);
  }

  function focusSessions() {
    if (!open.value) return;
    focused.value = true;
    void import("@/stores/compare").then(({ useCompareStore }) => {
      useCompareStore().blurCompare();
    });
    void import("@/stores/gitLog").then(({ useGitLogStore }) => {
      useGitLogStore().blurLog();
    });
  }

  function blurSessions() {
    focused.value = false;
  }

  /** 关闭终端标签：卸载视图并结束保活（PTY 随组件卸载退出） */
  function closeSessions() {
    open.value = false;
    focused.value = false;
    dormant.value = false;
  }

  function setSubView(view: SessionSubView) {
    subView.value = view;
    dormant.value = false;
    open.value = true;
    focused.value = true;
  }

  function renumberLocalTitles() {
    localTerminals.value.forEach((t, i) => {
      t.title = `终端 ${i + 1}`;
    });
  }

  function addLocalTerminal(cwd: string | null = null) {
    seq += 1;
    const id = `local-${seq}`;
    localTerminals.value.push({
      id,
      title: `终端 ${localTerminals.value.length + 1}`,
      cwd,
    });
    renumberLocalTitles();
    activeLocalId.value = id;
    subView.value = "local";
    openSessions(cwd);
  }

  /**
   * 打开/切换工作区时：
   * - 本地终端一律重建
   * - 强制断开本窗口全部 SSH/SFTP 远程连接（活跃会话）
   * - 保留当前子视图（本地 / SSH）；已保存 SSH 主机为全局配置（~/.mirocode/），不随项目切换
   */
  async function resetLocalForWorkspace(cwd: string | null) {
    const remotes = remoteSessions.value.slice();
    for (const session of remotes) {
      try {
        await sshShellClose(session.id);
      } catch {
        // 已断开则忽略
      }
      try {
        await sftpClose(sftpSessionId(session.id));
      } catch {
        // 未打开 SFTP 则忽略
      }
    }
    remoteSessions.value = [];
    activeRemoteId.value = null;

    const keepUiOpen = open.value;
    const wasDormant = dormant.value;
    const hadLocal = localTerminals.value.length > 0;
    const keepSubView = subView.value;
    localTerminals.value = [];
    activeLocalId.value = null;
    subView.value = keepSubView;
    dormant.value = false;

    if (keepUiOpen || wasDormant || hadLocal) {
      ensureDefaultLocal(cwd);
      if (wasDormant && !keepUiOpen) {
        dormant.value = true;
      }
    }
  }

  function closeLocalTerminal(id: string) {
    const idx = localTerminals.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    localTerminals.value.splice(idx, 1);
    renumberLocalTitles();
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
    const title =
      config.displayName?.trim() || `${config.username}@${config.host}`;
    remoteSessions.value.push({
      id,
      title,
      config,
      pane: "shell",
      sftpOpened: false,
    });
    activeRemoteId.value = id;
    subView.value = "remote";
    dormant.value = false;
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

  /** 打开本地终端视图并向活动本地终端写入命令（含回车） */
  function runInLocalTerminal(command: string, cwd: string | null = null) {
    openSessions(cwd);
    focusSessions();
    const id = activeLocalId.value;
    if (!id) return;
    const data = command.endsWith("\r") || command.endsWith("\n")
      ? command
      : `${command}\r`;
    writeSeq += 1;
    pendingLocalWrite.value = { terminalId: id, data, seq: writeSeq };
  }

  function consumePendingLocalWrite(seq: number) {
    if (pendingLocalWrite.value?.seq === seq) {
      pendingLocalWrite.value = null;
    }
  }

  // 兼容旧命名
  const addRemoteTerminal = addRemoteSession;
  const closeRemoteTerminal = closeRemoteSession;

  return {
    tabId,
    open,
    focused,
    dormant,
    mounted,
    isFocused,
    subView,
    localTerminals,
    activeLocalId,
    remoteSessions,
    activeRemoteId,
    pendingLocalWrite,
    /** @deprecated 使用 remoteSessions */
    remoteTerminals: remoteSessions,
    openSessions,
    hideSessions,
    toggleSessions,
    focusSessions,
    blurSessions,
    closeSessions,
    setSubView,
    addLocalTerminal,
    resetLocalForWorkspace,
    closeLocalTerminal,
    activateLocal,
    addRemoteSession,
    closeRemoteSession,
    activateRemote,
    setRemotePane,
    markSftpOpened,
    runInLocalTerminal,
    consumePendingLocalWrite,
    addRemoteTerminal,
    closeRemoteTerminal,
  };
});
