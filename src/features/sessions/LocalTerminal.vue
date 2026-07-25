<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { spawn, type IPty } from "tauri-pty";
import "@xterm/xterm/css/xterm.css";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  sessionId: string;
  cwd: string | null;
  active: boolean;
}>();

const host = ref<HTMLDivElement | null>(null);
const settings = useSettingsStore();
const { theme } = storeToRefs(settings);

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let pty: IPty | null = null;
let disposed = false;
let resizeObserver: ResizeObserver | null = null;

function themeColors() {
  const dark = theme.value !== "dawn";
  if (theme.value === "cyberpunk") {
    return {
      background: "#0a0610",
      foreground: "#f0e6ff",
      cursor: "#f0abfc",
      selectionBackground: "rgba(240,171,252,0.28)",
    };
  }
  if (theme.value === "midnight") {
    return {
      background: "#0b1220",
      foreground: "#e2e8f0",
      cursor: "#38bdf8",
      selectionBackground: "rgba(56,189,248,0.28)",
    };
  }
  if (dark) {
    return {
      background: "#0f0f12",
      foreground: "#f4f4f5",
      cursor: "#8b5cf6",
      selectionBackground: "rgba(139,92,246,0.28)",
    };
  }
  return {
    background: "#ffffff",
    foreground: "#18181b",
    cursor: "#3b82f6",
    selectionBackground: "rgba(59,130,246,0.22)",
  };
}

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
    theme: themeColors(),
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
  term.options.theme = themeColors();
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
  background: var(--bg-app);
}

.terminal-host :deep(.xterm) {
  height: 100%;
}

.terminal-host :deep(.xterm-viewport) {
  overflow-y: auto !important;
}
</style>
