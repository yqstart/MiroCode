import { computed, ref } from "vue";
import { defineStore } from "pinia";

export interface LocalTerminalSession {
  id: string;
  title: string;
  cwd: string | null;
}

const SESSIONS_TAB_ID = "miro://sessions";

/**
 * 本地终端会话：作为编辑区标签打开（⌘J / 活动栏「终端」按钮）。
 * SSH 远程会话已拆分为独立标签（见 ssh store），与本 store 解耦。
 */
export const useSessionsStore = defineStore("sessions", () => {
  /** 终端标签是否出现在编辑区标签栏 */
  const open = ref(false);
  const focused = ref(false);
  /**
   * 快捷键隐藏后会话仍存活：视图保持挂载、PTY 不销毁，
   * 与关闭标签（卸载并结束进程）区分。
   */
  const dormant = ref(false);
  const localTerminals = ref<LocalTerminalSession[]>([]);
  const activeLocalId = ref<string | null>(null);
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
  const mounted = computed(() => open.value || dormant.value);
  const hasAnySession = computed(() => localTerminals.value.length > 0);

  function blurPeers() {
    void import("@/stores/compare").then(({ useCompareStore }) => {
      useCompareStore().blurCompare();
    });
    void import("@/stores/gitLog").then(({ useGitLogStore }) => {
      useGitLogStore().blurLog();
    });
    void import("@/stores/ssh").then(({ useSshStore }) => {
      useSshStore().blurSsh();
    });
  }

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
    const restoring = dormant.value;
    dormant.value = false;
    open.value = true;
    focused.value = true;
    if (restoring) return;
    ensureDefaultLocal(cwd);
    blurPeers();
  }

  /** 隐藏终端标签但保留会话与 PTY（⌘/Ctrl+J） */
  function hideSessions() {
    if (!open.value) return;
    open.value = false;
    focused.value = false;
    dormant.value = hasAnySession.value;
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
    blurPeers();
  }

  function blurSessions() {
    focused.value = false;
  }

  /** 关闭终端标签：卸载视图并结束保活（PTY 随组件卸载退出） */
  async function closeSessions(): Promise<boolean> {
    localTerminals.value = [];
    activeLocalId.value = null;
    open.value = false;
    focused.value = false;
    dormant.value = false;
    return true;
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
    openSessions(cwd);
  }

  /**
   * 打开/切换工作区时：本地终端一律重建（cwd 跟随新项目根）。
   * SSH 远程连接强制断开逻辑见 ssh store 的 resetForWorkspace。
   */
  async function resetLocalForWorkspace(cwd: string | null) {
    const keepUiOpen = open.value;
    const wasDormant = dormant.value;
    const hadLocal = localTerminals.value.length > 0;
    localTerminals.value = [];
    activeLocalId.value = null;
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
    if (localTerminals.value.length === 0) {
      void closeSessions();
    }
  }

  function activateLocal(id: string) {
    activeLocalId.value = id;
    focusSessions();
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

  return {
    tabId,
    open,
    focused,
    dormant,
    mounted,
    isFocused,
    localTerminals,
    activeLocalId,
    pendingLocalWrite,
    openSessions,
    hideSessions,
    toggleSessions,
    focusSessions,
    blurSessions,
    closeSessions,
    addLocalTerminal,
    resetLocalForWorkspace,
    closeLocalTerminal,
    activateLocal,
    runInLocalTerminal,
    consumePendingLocalWrite,
  };
});
