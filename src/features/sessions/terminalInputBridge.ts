import type { Terminal } from "@xterm/xterm";

/** 是否为 macOS（Tauri 桌面壳走 WKWebView） */
function isMacPlatform(): boolean {
  return /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
}

function isWhitespaceOnly(data: string): boolean {
  return /^[\s\u00a0\u3000]+$/.test(data);
}

/** 拼音音节分隔符 / 弯撇号：中英切换时常被 IME 误提交（main → mai'n） */
function isImeApostrophe(data: string): boolean {
  return data === "'" || data === "\u2019" || data === "\u02bc";
}

/** Vim 等全屏 TUI 会切到 alternate buffer */
function isTuiActive(term: Terminal): boolean {
  try {
    return term.buffer.active.type !== term.buffer.normal.type;
  } catch {
    return false;
  }
}

function syncTuiChrome(term: Terminal, active: boolean) {
  const root = term.element?.closest(".terminal-host");
  root?.classList.toggle("tui-mode", active);
  const textarea = term.textarea;
  if (!textarea) return;
  if (active) {
    textarea.setAttribute("inputmode", "none");
    textarea.setAttribute("lang", "en");
    textarea.setAttribute("autocorrect", "off");
    textarea.setAttribute("autocapitalize", "off");
  } else {
    textarea.removeAttribute("inputmode");
    textarea.removeAttribute("lang");
  }
}

/**
 * 修复 macOS WKWebView + 中文输入法下 xterm 的输入缺陷；
 * 进入 alternate buffer（Vim 等 TUI）时自动 bypass，避免 i 模式/方向键失效。
 *
 * @returns dispose
 */
export function attachTerminalInputBridge(
  term: Terminal,
  write: (data: string) => void,
): () => void {
  const cleanups: Array<() => void> = [];
  let tuiMode = isTuiActive(term);
  syncTuiChrome(term, tuiMode);

  const textarea = term.textarea;
  if (textarea) {
    textarea.setAttribute("spellcheck", "false");
    textarea.setAttribute("autocapitalize", "off");
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
  }

  const bufferDisp = term.buffer.onBufferChange(() => {
    const next = isTuiActive(term);
    if (next === tuiMode) return;
    tuiMode = next;
    syncTuiChrome(term, tuiMode);
    if (tuiMode && textarea) textarea.value = "";
  });
  cleanups.push(() => bufferDisp.dispose());

  if (!isMacPlatform() || !textarea) {
    const dataDisp = term.onData((data) => {
      if (tuiMode) {
        write(data);
        return;
      }
      write(data);
    });
    cleanups.push(() => dataDisp.dispose());
    cleanups.push(() => syncTuiChrome(term, false));
    return () => {
      for (const fn of cleanups) fn();
    };
  }

  const ime = {
    keyDownSeen: false,
    last229At: 0,
    lastDeleteAt: 0,
    lastNonAsciiCommitAt: 0,
    lastCompositionEndAt: 0,
    composing: false,
    lastWriteData: "",
    lastWriteAt: 0,
  };

  function rawWrite(data: string) {
    if (!data) return;
    write(data);
  }

  function safeWrite(data: string) {
    if (!data) return;
    if (tuiMode) {
      rawWrite(data);
      return;
    }
    const now = performance.now();
    if (
      data.length <= 2 &&
      isWhitespaceOnly(data) &&
      data === ime.lastWriteData &&
      now - ime.lastWriteAt < 50
    ) {
      return;
    }
    if (data === ime.lastWriteData && now - ime.lastWriteAt < 28) {
      return;
    }
    ime.lastWriteData = data;
    ime.lastWriteAt = now;
    write(data);
  }

  const dataDisp = term.onData((data) => {
    if (tuiMode) {
      rawWrite(data);
      return;
    }
    const now = performance.now();
    if (
      isWhitespaceOnly(data) &&
      (now - ime.lastCompositionEndAt < 220 ||
        now - ime.lastDeleteAt < 140)
    ) {
      return;
    }
    if (
      isImeApostrophe(data) &&
      (ime.composing ||
        now - ime.lastCompositionEndAt < 450 ||
        now - ime.last229At < 450)
    ) {
      return;
    }
    safeWrite(data);
  });
  cleanups.push(() => dataDisp.dispose());

  const markCompositionStart = () => {
    if (tuiMode) return;
    ime.composing = true;
  };
  const markCompositionEnd = () => {
    ime.composing = false;
    ime.lastCompositionEndAt = performance.now();
    textarea.value = "";
  };
  textarea.addEventListener("compositionstart", markCompositionStart, true);
  textarea.addEventListener("compositionend", markCompositionEnd, true);
  cleanups.push(() => {
    textarea.removeEventListener("compositionstart", markCompositionStart, true);
    textarea.removeEventListener("compositionend", markCompositionEnd, true);
  });

  const host = term.element;
  if (host) {
    const onImeCommitInput = (ev: Event) => {
      if (tuiMode) return;
      if (ev.target !== textarea) return;
      const ie = ev as InputEvent;
      if (ie.inputType !== "insertText" || !ie.data || ie.isComposing) return;
      if (isWhitespaceOnly(ie.data) || isImeApostrophe(ie.data)) {
        ev.stopPropagation();
        textarea.value = "";
        return;
      }
      if (!/[^\x00-\x7f]/.test(ie.data)) return;
      ime.lastNonAsciiCommitAt = performance.now();
      if (term.options.screenReaderMode) return;
      if (performance.now() - ime.last229At < 50) return;
      if (performance.now() - ime.lastCompositionEndAt < 100) return;
      if (!ie.composed || !ime.keyDownSeen) return;
      safeWrite(ie.data);
      ev.stopPropagation();
      textarea.value = "";
    };
    host.addEventListener("input", onImeCommitInput, true);
    cleanups.push(() =>
      host.removeEventListener("input", onImeCommitInput, true),
    );
  }

  const onBeforeInput = (ev: InputEvent) => {
    if (tuiMode) return;
    if (ev.isComposing || ime.composing) return;
    if (ev.inputType !== "insertText" || !ev.data) return;
    const afterDelete = performance.now() - ime.lastDeleteAt < 140;
    const afterComposition = performance.now() - ime.lastCompositionEndAt < 450;
    const after229 = performance.now() - ime.last229At < 450;
    if (isImeApostrophe(ev.data) && (afterComposition || after229)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      textarea.value = "";
      return;
    }
    if (!isWhitespaceOnly(ev.data)) return;
    if (afterDelete || afterComposition) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      textarea.value = "";
    }
  };
  textarea.addEventListener("beforeinput", onBeforeInput, true);
  cleanups.push(() =>
    textarea.removeEventListener("beforeinput", onBeforeInput, true),
  );

  term.attachCustomKeyEventHandler((e) => {
    // TUI 模式：完全交给 xterm，避免 IME 桥截获 i/j/k/方向键等
    if (tuiMode) return true;

    if (e.type === "keydown") {
      ime.keyDownSeen = true;
      if (e.keyCode === 229) ime.last229At = performance.now();
    } else if (e.type === "keyup") {
      ime.keyDownSeen = false;
    }

    if (e.type !== "keydown") return true;

    const isArrow =
      e.code === "ArrowLeft" ||
      e.code === "ArrowRight" ||
      e.code === "ArrowUp" ||
      e.code === "ArrowDown";

    if (isArrow) {
      textarea.value = "";
      if (
        (e.code === "ArrowLeft" || e.code === "ArrowRight") &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.isComposing &&
        !ime.composing &&
        performance.now() - ime.lastNonAsciiCommitAt < 180
      ) {
        return false;
      }
      return true;
    }

    const isBackspace = e.code === "Backspace" || e.key === "Backspace";
    const isDelete = e.code === "Delete" || e.key === "Delete";
    if (!isBackspace && !isDelete) return true;

    ime.lastDeleteAt = performance.now();

    if (e.isComposing || ime.composing) {
      return false;
    }

    // 带修饰键（⌘/⌥/⌃/⇧）的删除（如 shell 的整词删除）交给 xterm 原样处理
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
      return true;
    }

    // 统一由本桥接处理纯删除键：直接写控制字符并阻止浏览器默认，
    // 避免 WKWebView 把 Backspace 上报为空格等错误输入（「按删除键出空格」根因）。
    // 用 rawWrite 绕过 safeWrite 去重，保证按住删除键可连续删除。
    rawWrite(isBackspace ? "\x7f" : "\x1b[3~");
    textarea.value = "";
    e.preventDefault();
    return false;
  });

  cleanups.push(() => syncTuiChrome(term, false));

  return () => {
    for (const fn of cleanups) fn();
  };
}

/** 终端推荐选项：避免过大 lineHeight 导致 CJK/组字层错位 */
export function terminalBaseOptions() {
  return {
    cursorBlink: true,
    fontFamily:
      'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "PingFang SC", "Noto Sans Mono CJK SC", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    letterSpacing: 0,
    allowProposedApi: true as const,
    macOptionIsMeta: true,
    scrollback: 10000,
    /** 右键点按选中整词（macOS 终端惯例） */
    rightClickSelectsWord: true,
    /** Shift+滚轮加速滚动回滚区（非 Vim 全屏时） */
    fastScrollModifier: "shift" as const,
  };
}
