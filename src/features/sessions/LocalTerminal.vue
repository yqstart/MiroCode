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

/** 宿主是否真正可见（尺寸非 0）：v-show 隐藏（display:none）时不可见 */
function hostVisible(): boolean {
  const el = host.value;
  return Boolean(el && el.clientWidth > 0 && el.clientHeight > 0);
}

function spawnPty() {
  if (!term || disposed) return;
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
}

/**
 * 在宿主真正可见后再 fit + spawn，避免隐藏态（display:none）下以占位/错误尺寸
 * 启动 PTY——否则 shell 提示符（含当前目录）会按错误列宽写入并被折行，
 * 点击激活触发 resize 后与旧缓冲叠加，表现为「目录出现两遍 + 样式错乱」。
 */
function tryFitAndSpawn() {
  if (!term || !fitAddon || disposed) return;
  if (!hostVisible()) return;
  try {
    fitAddon.fit();
  } catch {
    // ignore
  }
  if (!pty) {
    spawnPty();
  } else {
    pty.resize(term.cols, term.rows);
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
  tryFitAndSpawn();

  resizeObserver = new ResizeObserver(() => tryFitAndSpawn());
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
      // 终端激活且宿主可见时：若 PTY 尚未启动（曾在隐藏态挂载）则此时补启动，
      // 已启动则按真实尺寸重新 fit，避免隐藏态错误列宽导致的提示符折行/叠加。
      tryFitAndSpawn();
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

/* xterm.css 默认 .xterm 与 .xterm-viewport 都是 background: #000，
   亮色主题下透出一行黑条（出现在终端最底部一行未铺满 canvas 的位置）。
   强制让 xterm 自身走主题色，避开黑底。 */
.terminal-fit :deep(.xterm),
.terminal-fit :deep(.xterm-viewport),
.terminal-fit :deep(.xterm-screen) {
  background-color: var(--bg-terminal, var(--bg-app)) !important;
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
