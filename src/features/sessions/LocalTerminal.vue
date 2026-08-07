<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { spawn, type IPty } from "tauri-pty";
import "@xterm/xterm/css/xterm.css";
import { storeToRefs } from "pinia";
import {
  attachTerminalInputBridge,
  terminalBaseOptions,
} from "@/features/sessions/terminalInputBridge";
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
let detachInput: (() => void) | null = null;

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
    ...terminalBaseOptions(),
    theme: terminalThemeColors(theme.value),
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

    detachInput = attachTerminalInputBridge(term, (data) => {
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
  detachInput?.();
  detachInput = null;
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
  { immediate: true },
);
</script>

<template>
  <!-- padding 放外层；xterm 挂无 padding 内层，避免 FitAddon 多算约 1 行导致 Vim 末行截断 -->
  <div class="terminal-host">
    <div ref="host" class="terminal-fit" />
  </div>
</template>

<style scoped>
.terminal-host {
  width: 100%;
  height: 100%;
  padding: 8px 10px 10px;
  overflow: hidden;
  background: var(--bg-terminal, var(--bg-app));
}

.terminal-fit {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-fit :deep(.xterm) {
  height: 100%;
}

/* 勿覆盖 viewport overflow：会破坏 Vim 等 TUI 的 alternate buffer */

/* 组字预览对齐主题，避免黑底白字叠在深色终端上难辨 */
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
