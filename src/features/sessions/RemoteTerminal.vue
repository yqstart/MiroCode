<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { storeToRefs } from "pinia";
import {
  attachTerminalInputBridge,
  terminalBaseOptions,
} from "@/features/sessions/terminalInputBridge";
import { terminalThemeColors } from "@/features/sessions/terminalTheme";
import {
  sshShellClose,
  sshShellOpen,
  sshShellResize,
  sshShellWrite,
  type SshConnectConfig,
} from "@/shared/sshApi";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  sessionId: string;
  config: SshConnectConfig;
  active: boolean;
}>();

const emit = defineEmits<{
  closed: [];
  failed: [message: string];
}>();

const host = ref<HTMLDivElement | null>(null);
const settings = useSettingsStore();
const { theme } = storeToRefs(settings);

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let disposed = false;
let connected = false;
/** 已通过 failed 上报，避免再走 closed 造成双重清理 */
let failedReported = false;
let resizeObserver: ResizeObserver | null = null;
let unlistenData: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;
let unlistenError: UnlistenFn | null = null;
let detachInput: (() => void) | null = null;
/** 串行写入 SSH 通道，避免并发 invoke 打乱 Vim 键序 */
let writeChain = Promise.resolve();

function queueSshWrite(data: string) {
  if (!data) return;
  writeChain = writeChain
    .then(() => sshShellWrite(props.sessionId, data))
    .catch((err) => {
      if (!term || disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      term.writeln(`\r\n\x1b[31m写入失败: ${message}\x1b[0m`);
    });
}

function fit() {
  if (!term || !fitAddon || !props.active) return;
  try {
    fitAddon.fit();
    if (connected) {
      void sshShellResize(props.sessionId, term.cols, term.rows);
    }
  } catch {
    // ignore
  }
}

async function boot() {
  if (!host.value || term) return;

  term = new Terminal({
    ...terminalBaseOptions(),
    theme: terminalThemeColors(theme.value),
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(host.value);
  await nextTick();
  fit();

  term.writeln(
    `\x1b[90m连接 ${props.config.username}@${props.config.host}:${props.config.port || 22} …\x1b[0m`,
  );

  try {
    unlistenData = await listen<string>(`ssh://data/${props.sessionId}`, (event) => {
      if (!term || disposed) return;
      term.write(event.payload);
    });
    unlistenError = await listen<string>(`ssh://error/${props.sessionId}`, (event) => {
      if (!term || disposed || failedReported) return;
      failedReported = true;
      connected = false;
      term.writeln(`\r\n\x1b[31m${event.payload}\x1b[0m`);
      emit("failed", event.payload);
    });
    unlistenExit = await listen(`ssh://exit/${props.sessionId}`, () => {
      connected = false;
      if (failedReported || disposed) return;
      term?.writeln("\r\n\x1b[90m[远程会话已结束]\x1b[0m");
      emit("closed");
    });

    await sshShellOpen(
      props.sessionId,
      props.config,
      term.cols || 80,
      term.rows || 24,
    );
    connected = true;
    term.focus();

    detachInput = attachTerminalInputBridge(term, (data) => {
      if (!connected) return;
      queueSshWrite(data);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    term.writeln(`\r\n\x1b[31m连接失败: ${message}\x1b[0m`);
    emit("failed", message);
  }

  resizeObserver = new ResizeObserver(() => fit());
  resizeObserver.observe(host.value);
}

onMounted(() => {
  void boot();
});

onBeforeUnmount(() => {
  disposed = true;
  resizeObserver?.disconnect();
  resizeObserver = null;
  detachInput?.();
  detachInput = null;
  void unlistenData?.();
  void unlistenExit?.();
  void unlistenError?.();
  unlistenData = null;
  unlistenExit = null;
  unlistenError = null;
  if (connected) {
    void sshShellClose(props.sessionId);
  }
  connected = false;
  term?.dispose();
  term = null;
  fitAddon = null;
});

watch(
  () => props.active,
  async (active) => {
    if (active) {
      await nextTick();
      fit();
      term?.focus();
    }
  },
);

watch(theme, () => {
  if (!term) return;
  term.options.theme = terminalThemeColors(theme.value);
});
</script>

<template>
  <div ref="host" class="terminal-host" />
</template>

<style scoped>
.terminal-host {
  width: 100%;
  height: 100%;
  padding: 8px 10px 10px;
  overflow: hidden;
  background: var(--bg-terminal, var(--bg-app));
}

.terminal-host :deep(.xterm) {
  height: 100%;
}

/* 勿覆盖 viewport overflow：会破坏 Vim 等 TUI 的 alternate buffer */

.terminal-host :deep(.composition-view) {
  background: var(--bg-panel);
  color: var(--text-primary);
  border-bottom: 1px solid var(--accent);
  padding: 0 2px;
}

.terminal-host.tui-mode :deep(.xterm-helper-textarea) {
  user-select: none !important;
  -webkit-user-select: none !important;
}

.terminal-host:not(.tui-mode) :deep(.xterm-helper-textarea) {
  user-select: text !important;
  -webkit-user-select: text !important;
}
</style>
