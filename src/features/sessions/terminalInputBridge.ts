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
    lastTabAt: 0,
    /**
     * 删除/Tab 键 keydown 后置 true：在 beforeinput 源头吞掉浏览器对 textarea
     * 的误插（WKWebView 下 keydown 的 preventDefault 不可靠）。
     * keydown 与 beforeinput 严格 1:1 配对，单次标志安全可靠。
     */
    suppressNextInsert: false,
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
    // 打包环境 WKWebView 下 Tab 会双发：同一次补全被触发两次，
    // 远程 shell 补全两次导致路径多出斜杠（如 `cd ser` + Tab → `cd services/` 后
    // 又被补全成 `services//`）。连续 Tab 去重，只放行第一次；
    // dev 下单发不受影响（手动连按切换补全候选的间隔通常大于该窗口）。
    if (data === "\t") {
      if (now - ime.lastTabAt < 120) return;
      ime.lastTabAt = now;
    }
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
    // 删除控制字符：xterm custom handler 返回 true 后经 onData 派发，
    // 用 rawWrite 绕过 safeWrite 去重，保证按住删除键可连续删除。
    if (data === "\x7f" || data === "\x1b[3~") {
      rawWrite(data);
      return;
    }
    const now = performance.now();
    // 删除/Tab 后的误插空白兜底（主防线在 beforeinput，此处为副防线）
    if (
      isWhitespaceOnly(data) &&
      (now - ime.lastCompositionEndAt < 300 || now - ime.lastDeleteAt < 300)
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
    textarea.removeEventListener(
      "compositionstart",
      markCompositionStart,
      true,
    );
    textarea.removeEventListener("compositionend", markCompositionEnd, true);
  });

  const host = term.element;
  if (host) {
    const onImeCommitInput = (ev: Event) => {
      if (tuiMode) return;
      if (ev.target !== textarea) return;
      const ie = ev as InputEvent;
      if (ie.isComposing) return;
      const now = performance.now();
      // 删除/Tab 后的误插空白兜底（主防线在 beforeinput，此处为副防线）：
      // 打包环境 preventDefault 不可靠时，浏览器对 textarea 的 input 事件
      // 可能绕过 beforeinput 直达此处。删除时间窗内的空白/删除类 input 一律拦截。
      if (ime.suppressNextInsert || now - ime.lastDeleteAt < 300) {
        ime.suppressNextInsert = false;
        if (
          !ie.data ||
          isWhitespaceOnly(ie.data) ||
          ie.inputType.startsWith("delete")
        ) {
          ev.stopPropagation();
          textarea.value = "";
          return;
        }
      }
      if (ie.inputType !== "insertText" || !ie.data) return;
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
    // 主防线：删除/Tab 键 keydown 后，浏览器试图往 textarea 插入内容时
    // 在源头拦截。beforeinput 先于 input 触发，preventDefault 可阻止
    // textarea 插入 -> 断绝 xterm _inputEvent 二次派发空白的路径。
    // keydown 与 beforeinput 严格 1:1 配对，单次标志安全可靠。
    if (ime.suppressNextInsert) {
      ime.suppressNextInsert = false;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      textarea.value = "";
      return;
    }
    if (ev.inputType !== "insertText" || !ev.data) return;
    const afterDelete = performance.now() - ime.lastDeleteAt < 300;
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
    const isTab = e.code === "Tab" || e.key === "Tab";

    // 其他普通按键 keydown：清除误插拦截标志（仅删除/Tab 才需要拦截）
    if (!isBackspace && !isDelete && !isTab) {
      ime.suppressNextInsert = false;
    }

    if (!isBackspace && !isDelete) {
      // Tab 键：设标志让 beforeinput 吞掉浏览器对 textarea 的误插
      if (isTab) ime.suppressNextInsert = true;
      return true;
    }

    ime.lastDeleteAt = performance.now();
    // 设标志：beforeinput 源头拦截浏览器对 textarea 的误插（WKWebView 下
    // keydown 的 preventDefault 不可靠，beforeinput.preventDefault 更可靠）。
    ime.suppressNextInsert = true;

    if (e.isComposing || ime.composing) {
      return false;
    }

    // 带修饰键（⌘/⌥/⌃/⇧）的删除（如 shell 的整词删除）交给 xterm 原样处理
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
      return true;
    }

    // 返回 true 让 xterm 走完整 _keyDown 流程：
    // 1. xterm 自己 triggerDataEvent('\x7f') 经 onData 派发正确控制字符
    // 2. xterm 自己 cancel(event, true) 调 preventDefault（比 JS 手动调更可靠）
    // 之前的方案返回 false + 手动 rawWrite + 手动 preventDefault，
    // 导致 xterm 不调自身 preventDefault，WKWebView 下 textarea 被插入空格，
    // 经 xterm _inputEvent 二次派发泄漏到 SSH（「删除变空格」根因）。
    return true;
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
