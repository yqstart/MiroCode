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
let resizeObserver: ResizeObserver | null = null;
let unlistenData: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;
let detachInput: (() => void) | null = null;

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
    unlistenExit = await listen(`ssh://exit/${props.sessionId}`, () => {
      connected = false;
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
      void sshShellWrite(props.sessionId, data).catch(() => undefined);
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
  unlistenData = null;
  unlistenExit = null;
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

.terminal-host :deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.terminal-host :deep(.composition-view) {
  background: var(--bg-panel);
  color: var(--text-primary);
  border-bottom: 1px solid var(--accent);
  padding: 0 2px;
}

.terminal-host :deep(.xterm-helper-textarea) {
  user-select: text !important;
  -webkit-user-select: text !important;
}
</style>
