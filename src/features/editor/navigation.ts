import { EditorView, ViewPlugin, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  IMPORT_RE,
  PATH_RE,
  resolveImportCandidate,
  resolveImportPath,
} from "@/shared/importReferences";
import {
  findSymbolDefinition,
  wordAt,
} from "@/features/editor/documentSymbols";

export interface NavTarget {
  path: string;
  line: number;
  column: number;
  kind: "import" | "symbol";
}

function findImportSpecAtPos(doc: string, pos: number): string | null {
  for (const re of [IMPORT_RE, PATH_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(doc))) {
      const start = match.index;
      const end = start + match[0].length;
      if (pos >= start && pos <= end) {
        return match[1];
      }
    }
  }
  return null;
}

/** 同步：仅用于下划线提示 */
export function findTargetAtPos(
  doc: string,
  pos: number,
  workspaceRoot: string | null,
  currentFile: string,
): NavTarget | null {
  const spec = findImportSpecAtPos(doc, pos);
  if (spec?.startsWith(".")) {
    const resolved = resolveImportCandidate(workspaceRoot, currentFile, spec);
    if (resolved) {
      return { path: resolved, line: 1, column: 1, kind: "import" };
    }
  }

  const sym = findSymbolDefinition(doc, pos, currentFile);
  if (sym) {
    return {
      path: currentFile,
      line: sym.line,
      column: sym.column,
      kind: "symbol",
    };
  }
  return null;
}

/** 异步：实际跳转（磁盘存在性校验 + 扩展名解析） */
export async function findTargetAtPosAsync(
  doc: string,
  pos: number,
  workspaceRoot: string | null,
  currentFile: string,
): Promise<NavTarget | null> {
  const spec = findImportSpecAtPos(doc, pos);
  if (spec?.startsWith(".") && workspaceRoot) {
    const resolved = await resolveImportPath(workspaceRoot, currentFile, spec);
    if (resolved) {
      return { path: resolved, line: 1, column: 1, kind: "import" };
    }
  }

  const sym = findSymbolDefinition(doc, pos, currentFile);
  if (sym) {
    return {
      path: currentFile,
      line: sym.line,
      column: sym.column,
      kind: "symbol",
    };
  }

  // 光标在 import 绑定名上、但未落在整段 match 时（极少）；再试单词级符号
  return null;
}

export interface NavigationHandlers {
  onNavigate: (path: string, line: number, column: number) => void;
  onGoBack: () => void;
  workspaceRoot: () => string | null;
  currentFile: () => string;
}

const linkMark = Decoration.mark({ class: "cm-nav-link" });

function createLinkDecorations(view: EditorView, handlers: NavigationHandlers): DecorationSet {
  const pos = view.state.selection.main.head;
  const doc = view.state.doc.toString();
  const hit = wordAt(doc, pos);
  const spec = findImportSpecAtPos(doc, pos);

  // import 路径上的任意位置都可提示；符号则要求落在单词上
  if (!spec && (!hit || pos < hit.from || pos > hit.to)) {
    return Decoration.none;
  }

  const target = findTargetAtPos(
    doc,
    pos,
    handlers.workspaceRoot(),
    handlers.currentFile(),
  );
  if (!target) return Decoration.none;

  if (target.kind === "import" && spec) {
    // 高亮路径字符串本身
    for (const re of [IMPORT_RE, PATH_RE]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(doc))) {
        if (match[1] !== spec) continue;
        const full = match[0];
        const specOffset = full.lastIndexOf(spec);
        if (specOffset < 0) continue;
        const from = match.index + specOffset;
        const to = from + spec.length;
        if (pos >= match.index && pos <= match.index + full.length) {
          return Decoration.set([linkMark.range(from, to)]);
        }
      }
    }
  }

  if (hit) {
    return Decoration.set([linkMark.range(hit.from, hit.to)]);
  }
  return Decoration.none;
}

async function navigateFromView(
  view: EditorView,
  handlers: NavigationHandlers,
  pos: number,
): Promise<boolean> {
  const target = await findTargetAtPosAsync(
    view.state.doc.toString(),
    pos,
    handlers.workspaceRoot(),
    handlers.currentFile(),
  );
  if (!target) return false;
  handlers.onNavigate(target.path, target.line, target.column);
  return true;
}

export function createNavigationExtension(handlers: NavigationHandlers): Extension {
  const linkPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = createLinkDecorations(view, handlers);
      }

      update(update: import("@codemirror/view").ViewUpdate) {
        if (update.selectionSet || update.docChanged) {
          this.decorations = createLinkDecorations(update.view, handlers);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [
    linkPlugin,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const mod = event.metaKey || event.ctrlKey;
        if (!mod || event.button !== 0) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        // 先同步判断是否可能跳转，避免误吞点击
        const maybe = findTargetAtPos(
          view.state.doc.toString(),
          pos,
          handlers.workspaceRoot(),
          handlers.currentFile(),
        );
        if (!maybe) return false;
        event.preventDefault();
        void navigateFromView(view, handlers, pos);
        return true;
      },
    }),
    EditorView.baseTheme({
      ".cm-nav-link": {
        textDecoration: "underline",
        textUnderlineOffset: "2px",
        cursor: "pointer",
        color: "var(--accent)",
      },
    }),
  ];
}

export function goToDefinitionKeymap(handlers: NavigationHandlers) {
  return [
    {
      key: "Mod-Enter",
      run(view: EditorView) {
        const pos = view.state.selection.main.head;
        const maybe = findTargetAtPos(
          view.state.doc.toString(),
          pos,
          handlers.workspaceRoot(),
          handlers.currentFile(),
        );
        if (!maybe) return false;
        void navigateFromView(view, handlers, pos);
        return true;
      },
    },
    {
      key: "F12",
      run(view: EditorView) {
        const pos = view.state.selection.main.head;
        const maybe = findTargetAtPos(
          view.state.doc.toString(),
          pos,
          handlers.workspaceRoot(),
          handlers.currentFile(),
        );
        if (!maybe) return false;
        void navigateFromView(view, handlers, pos);
        return true;
      },
    },
  ];
}

export function goBackKeymap(handlers: NavigationHandlers) {
  return {
    key: "Mod-[",
    run() {
      handlers.onGoBack();
      return true;
    },
  };
}
