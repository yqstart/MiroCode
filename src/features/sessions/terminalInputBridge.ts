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

/**
 * 修复 macOS WKWebView + 中文输入法下 xterm 的输入缺陷：
 * 1. 组字中按退格时，xterm 会 finalize 并把拼音甩进 PTY → 看起来像删不掉、乱出字
 * 2. 非组字但 keyCode=229 时，textarea diff 常把空格/残字符当成「新增」送进 PTY → Delete 变追加空格
 * 3. 中文标点（Shift+数字）在 commit-first 顺序下会被 `_keyDownSeen` 门控丢掉
 * 4. 配对标点 IME 合成的 ArrowLeft 会把真光标拽乱；方向键还会把 textarea 残值甩进终端
 * 5. 中文切英文后 IME 常误插间隔符 / 重复提交 → 空格变双倍、英文内容翻倍
 * 6. 中文切英文后 IME 常甩进音节撇号 → main 变成 mai'n
 *
 * @returns dispose
 */
export function attachTerminalInputBridge(
  term: Terminal,
  write: (data: string) => void,
): () => void {
  const cleanups: Array<() => void> = [];

  const textarea = term.textarea;
  if (textarea) {
    textarea.setAttribute("spellcheck", "false");
    textarea.setAttribute("autocapitalize", "off");
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
    textarea.style.setProperty("user-select", "text");
    textarea.style.setProperty("-webkit-user-select", "text");
  }

  if (!isMacPlatform() || !textarea) {
    const dataDisp = term.onData(write);
    cleanups.push(() => dataDisp.dispose());
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
    /** 去重：短窗口内相同 payload 只投一次（防空格/IME 双写） */
    lastWriteData: "",
    lastWriteAt: 0,
  };

  function safeWrite(data: string) {
    if (!data) return;
    const now = performance.now();
    // 单字符空白：50ms 内去重（双空格主因）
    if (
      data.length <= 2 &&
      isWhitespaceOnly(data) &&
      data === ime.lastWriteData &&
      now - ime.lastWriteAt < 50
    ) {
      return;
    }
    // 任意相同 payload：28ms 内去重（中英切换重复提交）
    if (data === ime.lastWriteData && now - ime.lastWriteAt < 28) {
      return;
    }
    ime.lastWriteData = data;
    ime.lastWriteAt = now;
    write(data);
  }

  const dataDisp = term.onData((data) => {
    const now = performance.now();
    // 组字结束后极短窗口内的纯空白：IME 误插，丢弃
    if (
      isWhitespaceOnly(data) &&
      (now - ime.lastCompositionEndAt < 220 ||
        now - ime.lastDeleteAt < 140)
    ) {
      return;
    }
    // 中英切换 / 组字结束窗口内的孤立撇号（mai'n）
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

  // 补投 xterm 因 `_keyDownSeen` 丢掉的中文标点 commit（绝不转发 ASCII/空白，避免双写）
  const host = term.element;
  if (host) {
    const onImeCommitInput = (ev: Event) => {
      if (ev.target !== textarea) return;
      const ie = ev as InputEvent;
      if (ie.inputType !== "insertText" || !ie.data || ie.isComposing) return;
      if (isWhitespaceOnly(ie.data) || isImeApostrophe(ie.data)) {
        ev.stopPropagation();
        textarea.value = "";
        return;
      }
      // 仅补投非 ASCII（中文标点等）；ASCII 一律走 onData，避免空格/英文字符双写
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

  // 拦截「删成空格 / 组字后误插间隔符 / 中英切换撇号」
  const onBeforeInput = (ev: InputEvent) => {
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

    // 方向键：清空 textarea 残值，避免把历史输入甩进 PTY
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
        // 配对标点后的合成方向键：不要进 PTY
        return false;
      }
      return true;
    }

    const isBackspace = e.code === "Backspace" || e.key === "Backspace";
    const isDelete = e.code === "Delete" || e.key === "Delete";
    if (!isBackspace && !isDelete) return true;

    ime.lastDeleteAt = performance.now();

    // 组字中：交给 IME，禁止 xterm CompositionHelper finalize 把拼音提交进终端
    if (e.isComposing || ime.composing) {
      return false;
    }

    // macOS：自行投递 DEL，跳过 xterm textarea value-diff（会误插空格）
    safeWrite(isBackspace ? "\x7f" : "\x1b[3~");
    textarea.value = "";
    e.preventDefault();
    return false;
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
    /** 等宽：避免空格视觉上被拉宽 */
    letterSpacing: 0,
    allowProposedApi: true as const,
    macOptionIsMeta: true,
  };
}
