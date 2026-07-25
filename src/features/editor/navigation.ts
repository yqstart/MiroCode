import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { dirname, joinPath } from "@/shared/fs";

const IMPORT_RE =
  /(?:import\s+(?:[\w*{}\s,]+\s+from\s+|)|require\s*\(\s*|from\s+)['"]([^'"]+)['"]/g;
const PATH_RE = /['"](\.{1,2}\/[^'"]+)['"]/g;

function resolveImport(
  workspaceRoot: string | null,
  currentFile: string,
  spec: string,
): string | null {
  if (!workspaceRoot || !spec.startsWith(".")) return null;
  const base = dirname(currentFile);
  let target = joinPath(base, spec);

  const extensions = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".vue",
    ".json",
    "/index.ts",
    "/index.js",
  ];
  for (const ext of extensions) {
    const candidate = ext.startsWith("/")
      ? `${target}${ext}`
      : `${target}${ext}`;
    if (candidate.startsWith(workspaceRoot)) return candidate;
  }

  if (target.startsWith(workspaceRoot)) return target;
  return null;
}

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
        const resolved = resolveImport(workspaceRoot, currentFile, spec);
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
