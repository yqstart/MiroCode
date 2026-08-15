import { computed, ref } from "vue";
import { defineStore } from "pinia";

export interface LocalTerminalSession {
  id: string;
  title: string;
  cwd: string | null;
}

/**
 * 本地终端会话：作为底部面板打开（状态栏左下角按钮 / ⌘J / 资源树右键「在终端中打开」）。
 * SSH 远程会话已拆分为独立标签（见 ssh store），与本 store 解耦。
 */
export const useSessionsStore = defineStore("sessions", () => {
  /** 终端底部面板是否展开（对应 AppShell 中 TerminalPanel 的 v-show） */
  const open = ref(false);
  const focused = ref(false);
  /**
   * 快捷键收起后面板仍保活：视图保持挂载、PTY 不销毁，
   * 与关闭全部终端（卸载并结束进程）区分。
   */
  const dormant = ref(false);
  const localTerminals = ref<LocalTerminalSession[]>([]);
  const activeLocalId = ref<string | null>(null);
  /**
   * 各本地终端是否空闲（shell 停在提示符上）。由 LocalTerminal 解析 PTY 输出
   * 上报（见 features/sessions/terminalIdle.ts）。缺省 undefined = 未知（PTY 未
   * 启动），按「可用」处理。
   */
  const localIdle = ref<Record<string, boolean>>({});
  /** 注入到本地 PTY 的待发送输入 */
  const pendingLocalWrite = ref<{
    terminalId: string;
    data: string;
    seq: number;
  } | null>(null);
  let seq = 0;
  let writeSeq = 0;

  const isFocused = computed(() => open.value && focused.value);
  /** 是否应挂载终端面板（显示中或收起保活） */
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
    // 底部面板与画布（SSH/GitLog/Compare）并存，打开面板不打断其它视图的聚焦
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
    localIdle.value = {};
    // 清空待注入命令：目标终端已销毁，残留任务永远无法被消费
    pendingLocalWrite.value = null;
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
    localIdle.value = {};
    // 旧终端全部销毁，其待注入命令作废
    pendingLocalWrite.value = null;
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
    delete localIdle.value[id];
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

  /** LocalTerminal 上报本终端的空闲状态（见 terminalIdle.ts） */
  function setLocalIdle(id: string, idle: boolean) {
    localIdle.value[id] = idle;
  }

  /** 打开本地终端视图并向活动本地终端写入命令（含回车）。
   *  活动终端正在跑任务（不空闲）时新开一个终端执行，避免命令叠加进 busy 终端。 */
  function runInLocalTerminal(command: string, cwd: string | null = null) {
    openSessions(cwd);
    let id = activeLocalId.value;
    // 未知（PTY 未启动）按可用处理；busy 或尚无终端则新开
    if (!id || localIdle.value[id] === false) {
      addLocalTerminal(cwd);
      id = activeLocalId.value;
    }
    if (!id) return;
    focusSessions();
    const data = command.endsWith("\r") || command.endsWith("\n")
      ? command
      : `${command}\r`;
    writeSeq += 1;
    pendingLocalWrite.value = { terminalId: id, data, seq: writeSeq };
    // 写入即忙：命令已注入但提示符检测尚未反应时，再次点击快捷方式不会叠进同一终端；
    // 命令结束后 shell 重新打印提示符，检测器会把 idle 恢复为 true。
    localIdle.value[id] = false;
  }

  function consumePendingLocalWrite(seq: number) {
    if (pendingLocalWrite.value?.seq === seq) {
      pendingLocalWrite.value = null;
    }
  }

  return {
    open,
    focused,
    dormant,
    mounted,
    isFocused,
    localTerminals,
    activeLocalId,
    localIdle,
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
    setLocalIdle,
    runInLocalTerminal,
    consumePendingLocalWrite,
  };
});
