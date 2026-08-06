import { EditorView, ViewPlugin, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  IMPORT_RE,
  PATH_RE,
  resolveImportCandidate,
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

function findImportTargetAtPos(
  doc: string,
  pos: number,
  workspaceRoot: string | null,
  currentFile: string,
): NavTarget | null {
  for (const re of [IMPORT_RE, PATH_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(doc))) {
      const start = match.index;
      const end = start + match[0].length;
      if (pos >= start && pos <= end) {
        const spec = match[1];
        const resolved = resolveImportCandidate(workspaceRoot, currentFile, spec);
        if (resolved) {
          return { path: resolved, line: 1, column: 1, kind: "import" };
        }
      }
    }
  }
  return null;
}

export function findTargetAtPos(
  doc: string,
  pos: number,
  workspaceRoot: string | null,
  currentFile: string,
): NavTarget | null {
  const importHit = findImportTargetAtPos(doc, pos, workspaceRoot, currentFile);
  if (importHit) return importHit;

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
  if (!hit || pos < hit.from || pos > hit.to) return Decoration.none;

  const target = findTargetAtPos(
    doc,
    pos,
    handlers.workspaceRoot(),
    handlers.currentFile(),
  );
  if (!target) return Decoration.none;

  return Decoration.set([linkMark.range(hit.from, hit.to)]);
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
        const target = findTargetAtPos(
          view.state.doc.toString(),
          pos,
          handlers.workspaceRoot(),
          handlers.currentFile(),
        );
        if (!target) return false;
        event.preventDefault();
        handlers.onNavigate(target.path, target.line, target.column);
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
        const target = findTargetAtPos(
          view.state.doc.toString(),
          pos,
          handlers.workspaceRoot(),
          handlers.currentFile(),
        );
        if (!target) return false;
        handlers.onNavigate(target.path, target.line, target.column);
        return true;
      },
    },
    {
      key: "F12",
      run(view: EditorView) {
        const pos = view.state.selection.main.head;
        const target = findTargetAtPos(
          view.state.doc.toString(),
          pos,
          handlers.workspaceRoot(),
          handlers.currentFile(),
        );
        if (!target) return false;
        handlers.onNavigate(target.path, target.line, target.column);
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
