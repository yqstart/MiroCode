import type { Terminal } from "@xterm/xterm";

/** 是否为 macOS（Tauri 桌面壳走 WKWebView） */
function isMacPlatform(): boolean {
  return /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
}

/**
 * 修复 macOS WKWebView + 中文输入法下 xterm 的输入缺陷：
 * 1. 组字中按退格时，xterm 会 finalize 并把拼音甩进 PTY → 看起来像删不掉、乱出字
 * 2. 非组字但 keyCode=229 时，textarea diff 常把空格/残字符当成「新增」送进 PTY → Delete 变追加空格
 * 3. 中文标点（Shift+数字）在 commit-first 顺序下会被 `_keyDownSeen` 门控丢掉
 * 4. 配对标点 IME 合成的 ArrowLeft 会把真光标拽乱
 *
 * @returns dispose
 */
export function attachTerminalInputBridge(
  term: Terminal,
  write: (data: string) => void,
): () => void {
  const cleanups: Array<() => void> = [];
  const dataDisp = term.onData(write);
  cleanups.push(() => dataDisp.dispose());

  const textarea = term.textarea;
  if (textarea) {
    // 软提示：偏好拉丁文，无法强制切换系统输入法
    textarea.setAttribute("lang", "en");
    textarea.setAttribute("spellcheck", "false");
    textarea.setAttribute("autocapitalize", "off");
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
    textarea.style.setProperty("user-select", "text");
    textarea.style.setProperty("-webkit-user-select", "text");
  }

  if (!isMacPlatform() || !textarea) {
    return () => {
      for (const fn of cleanups) fn();
    };
  }

  const ime = {
    keyDownSeen: false,
    last229At: 0,
    /** 最近一次「删除类」229 按键，用于拦 IME 误插空格 */
    last229DeleteAt: 0,
    lastNonAsciiCommitAt: 0,
    lastCompositionEndAt: 0,
  };

  const markCompositionEnd = () => {
    ime.lastCompositionEndAt = performance.now();
  };
  textarea.addEventListener("compositionend", markCompositionEnd, true);
  cleanups.push(() =>
    textarea.removeEventListener("compositionend", markCompositionEnd, true),
  );

  // 补投 xterm 因 `_keyDownSeen` 丢掉的中文标点 commit
  const host = term.element;
  if (host) {
    const onImeCommitInput = (ev: Event) => {
      if (ev.target !== textarea) return;
      const ie = ev as InputEvent;
      if (ie.inputType !== "insertText" || !ie.data || ie.isComposing) return;
      if (/[^\x00-\x7f]/.test(ie.data)) {
        ime.lastNonAsciiCommitAt = performance.now();
      }
      if (term.options.screenReaderMode) return;
      if (performance.now() - ime.last229At < 50) return;
      if (performance.now() - ime.lastCompositionEndAt < 100) return;
      // 与 xterm `_inputEvent` 条件互补：仅转发它会丢掉的那一类
      if (!ie.composed || !ime.keyDownSeen) return;
      write(ie.data);
      ev.stopPropagation();
      textarea.value = "";
    };
    host.addEventListener("input", onImeCommitInput, true);
    cleanups.push(() =>
      host.removeEventListener("input", onImeCommitInput, true),
    );
  }

  // 拦截「删成空格」：仅在删除键 229 之后，IME 往 textarea 误塞空白时切断
  const onBeforeInput = (ev: InputEvent) => {
    if (ev.isComposing) return;
    if (ev.inputType !== "insertText" || !ev.data) return;
    if (
      performance.now() - ime.last229DeleteAt < 80 &&
      /^[\s\u00a0\u3000]+$/.test(ev.data)
    ) {
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
    if (e.type === "keydown") {
      ime.keyDownSeen = true;
      if (e.keyCode === 229) ime.last229At = performance.now();
    } else if (e.type === "keyup") {
      ime.keyDownSeen = false;
    }

    if (e.type !== "keydown") return true;

    // 配对标点后的合成方向键：不要进 PTY
    if (
      (e.code === "ArrowLeft" || e.code === "ArrowRight") &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.shiftKey &&
      !e.isComposing &&
      performance.now() - ime.lastNonAsciiCommitAt < 150
    ) {
      return false;
    }

    const isBackspace = e.code === "Backspace" || e.key === "Backspace";
    const isDelete = e.code === "Delete" || e.key === "Delete";
    if (!isBackspace && !isDelete) return true;

    // 组字中：交给 IME，禁止 xterm CompositionHelper finalize 把拼音提交进终端
    if (e.isComposing) {
      return false;
    }

    // Process/229 删除键：自己投递 DEL，清空 textarea，跳过错误的 value-diff
    if (e.keyCode === 229 || e.key === "Process" || e.key === "Unidentified") {
      ime.last229DeleteAt = performance.now();
      write(isBackspace ? "\x7f" : "\x1b[3~");
      textarea.value = "";
      e.preventDefault();
      return false;
    }

    return true;
  });

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
    allowProposedApi: true as const,
    macOptionIsMeta: true,
  };
}
