<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { spawn, type IPty } from "tauri-pty";
import "@xterm/xterm/css/xterm.css";
import { storeToRefs } from "pinia";
import { terminalThemeColors } from "@/features/sessions/terminalTheme";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  sessionId: string;
  cwd: string | null;
  active: boolean;
}>();

const host = ref<HTMLDivElement | null>(null);
const settings = useSettingsStore();
const sessions = useSessionsStore();
const { theme } = storeToRefs(settings);
const { pendingLocalWrite } = storeToRefs(sessions);

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let pty: IPty | null = null;
let disposed = false;
let resizeObserver: ResizeObserver | null = null;

function defaultShell(): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "powershell.exe";
  if (platform.includes("mac")) return "/bin/zsh";
  return "/bin/bash";
}

function fit() {
  if (!term || !fitAddon || !props.active) return;
  try {
    fitAddon.fit();
    if (pty) {
      pty.resize(term.cols, term.rows);
    }
  } catch {
    // 尺寸未就绪时忽略
  }
}

async function boot() {
  if (!host.value || term) return;

  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.35,
    theme: terminalThemeColors(theme.value),
    allowProposedApi: true,
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(host.value);
  await nextTick();
  fit();

  try {
    pty = spawn(defaultShell(), [], {
      cols: term.cols,
      rows: term.rows,
      cwd: props.cwd ?? undefined,
      name: "xterm-256color",
    });

    pty.onData((data) => {
      if (!term || disposed) return;
      const text =
        typeof data === "string"
          ? data
          : new TextDecoder().decode(data);
      term.write(text);
    });

    pty.onExit(() => {
      term?.writeln("\r\n\x1b[90m[进程已退出]\x1b[0m");
    });

    term.onData((data) => {
      pty?.write(data);
    });
  } catch (error) {
    term.writeln(
      `\r\n\x1b[31m终端启动失败: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
    );
    term.writeln("\x1b[90m请确认已通过桌面应用运行（pnpm tauri:dev），而非纯浏览器预览。\x1b[0m");
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
  try {
    pty?.kill();
  } catch {
    // ignore
  }
  pty = null;
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

watch(
  pendingLocalWrite,
  async (job) => {
    if (!job || job.terminalId !== props.sessionId) return;
    for (let i = 0; i < 40 && !pty; i += 1) {
      await new Promise((r) => window.setTimeout(r, 50));
      if (disposed) return;
    }
    if (!pty || disposed) return;
    try {
      pty.write(job.data);
    } catch {
      // ignore
    }
    sessions.consumePendingLocalWrite(job.seq);
    if (props.active) {
      term?.focus();
    }
  },
);
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
</style>
