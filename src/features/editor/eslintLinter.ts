import type { Diagnostic } from "@codemirror/lint";
import { setDiagnostics } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { relativeToRoot } from "@/shared/fs";
import { lintWithEslint, type EslintDiag } from "@/shared/toolingApi";

function posAt(doc: Text, line: number, column: number): number {
  const clampedLine = Math.max(1, Math.min(line, doc.lines));
  const lineObj = doc.line(clampedLine);
  const col = Math.max(1, column);
  return lineObj.from + Math.min(col - 1, lineObj.length);
}

function toDiagnostics(doc: Text, raw: EslintDiag[]): Diagnostic[] {
  return raw.map((d) => {
    const from = posAt(doc, d.line, d.column);
    const to = posAt(doc, d.endLine, d.endColumn);
    return {
      from,
      to: Math.max(from, to),
      severity: d.severity === "error" ? "error" : "warning",
      message: d.message,
      source: "eslint",
    } satisfies Diagnostic;
  });
}

const ESLINT_EXTS = /\.(?:[cm]?[jt]sx?|vue|mjs|cjs)$/i;

/** 供 CodeMirrorEditor：防抖跑 ESLint 并输出诊断 */
export function createEslintScheduler(
  getView: () => EditorView | null,
  opts: {
    filePath: () => string;
    workspaceRoot: () => string | null;
    enabled: () => boolean;
    /** 诊断结果回调（用于与 LSP 诊断合流）；不传则直接 setDiagnostics */
    onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  },
) {
  let timer: number | null = null;
  let seq = 0;

  async function run() {
    const view = getView();
    if (!view) return;
    if (!opts.enabled()) {
      applyDiagnostics(view, []);
      return;
    }
    const root = opts.workspaceRoot();
    const path = opts.filePath();
    if (!root || !ESLINT_EXTS.test(path)) {
      applyDiagnostics(view, []);
      return;
    }
    const my = ++seq;
    try {
      const rel = relativeToRoot(root, path);
      const raw = await lintWithEslint(root, rel);
      if (my !== seq || getView() !== view) return;
      applyDiagnostics(view, toDiagnostics(view.state.doc, raw));
    } catch {
      if (my !== seq || getView() !== view) return;
      applyDiagnostics(view, []);
    }
  }

  /** 应用诊断：有 onDiagnostics 回调走合流器，否则直接 setDiagnostics */
  function applyDiagnostics(view: EditorView, diagnostics: Diagnostic[]) {
    if (opts.onDiagnostics) {
      opts.onDiagnostics(diagnostics);
    } else {
      view.dispatch(setDiagnostics(view.state, diagnostics));
    }
  }

  function schedule() {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void run();
    }, 600);
  }

  function dispose() {
    if (timer != null) window.clearTimeout(timer);
    timer = null;
    seq += 1;
    const view = getView();
    if (view) {
      try {
        applyDiagnostics(view, []);
      } catch {
        /* ignore */
      }
    }
  }

  return { schedule, runNow: run, dispose };
}
