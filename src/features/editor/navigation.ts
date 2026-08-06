import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  IMPORT_RE,
  PATH_RE,
  resolveImportCandidate,
} from "@/shared/importReferences";

function findTargetAtPos(
  doc: string,
  pos: number,
  workspaceRoot: string | null,
  currentFile: string,
): { path: string; line: number; column: number } | null {
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
          return { path: resolved, line: 1, column: 1 };
        }
      }
    }
  }
  return null;
}

export interface NavigationHandlers {
  onNavigate: (path: string, line: number, column: number) => void;
  onGoBack: () => void;
  workspaceRoot: () => string | null;
  currentFile: () => string;
}

export function createNavigationExtension(handlers: NavigationHandlers): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
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
  });
}

export function goToDefinitionKeymap(handlers: NavigationHandlers) {
  return {
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
  };
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
