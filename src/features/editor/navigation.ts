import { EditorView, ViewPlugin, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  IMPORT_RE,
  PATH_RE,
  TEMPLATE_BIND_RE,
  CLASS_ATTR_RE,
  resolveImportCandidate,
  resolveImportPath,
} from "@/shared/importReferences";
import {
  findSymbolDefinition,
  indexDocumentSymbols,
  wordAt,
} from "@/features/editor/documentSymbols";

export interface NavTarget {
  path: string;
  line: number;
  column: number;
  kind: "import" | "symbol";
}

/** 是否为本地模块 spec（相对路径或 `@/` 路径别名），可参与磁盘跳转 */
function isLocalImportSpec(spec: string | null | undefined): spec is string {
  return !!spec && (spec.startsWith(".") || spec.startsWith("@/"));
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

/**
 * Vue 模板绑定：把光标位置 `@click="foo"` / `v-on:click="foo"` / `{{ foo }}`
 * 解析为对标识符 `foo` 的引用，返回 word 区间。供 go-to-definition 跨段查找。
 */
function findTemplateBindAtPos(
  doc: string,
  pos: number,
): { word: string; from: number; to: number } | null {
  TEMPLATE_BIND_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEMPLATE_BIND_RE.exec(doc))) {
    const name = m[1];
    if (!name) continue;
    // 找的是 m[1] 在 m[0] 内的偏移
    const nameOffset = m[0].indexOf(name);
    if (nameOffset < 0) continue;
    const from = m.index + nameOffset;
    const to = from + name.length;
    if (pos >= from && pos <= to) {
      return { word: name, from, to };
    }
  }
  return null;
}

/**
 * HTML/Vue class 属性：`class="foo bar"` 中光标所在的那个 class 名。
 * 支持含连字符的 class（如 `my-class`），返回精确区间供 go-to-definition。
 */
function findClassAttrAtPos(
  doc: string,
  pos: number,
): { word: string; from: number; to: number } | null {
  CLASS_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLASS_ATTR_RE.exec(doc))) {
    const fullMatch = m[0];
    const valueStart = m.index + fullMatch.indexOf(m[1]);
    const valueEnd = valueStart + m[1].length;
    if (pos < valueStart || pos > valueEnd) continue;
    // 在 class 值里按空白拆分，找光标落在哪个 class 名上
    const value = m[1];
    let cur = valueStart;
    for (const part of value.split(/\s+/)) {
      if (!part) continue;
      const partFrom = cur;
      const partTo = cur + part.length;
      if (pos >= partFrom && pos <= partTo) {
        return { word: part, from: partFrom, to: partTo };
      }
      cur = partTo + 1; // 跳过空白
    }
  }
  return null;
}

/** 取光标处的 word：优先 class 属性，再模板绑定，最后 documentSymbols.wordAt */
function wordAtOrTemplateBind(
  doc: string,
  pos: number,
): { word: string; from: number; to: number } | null {
  const classHit = findClassAttrAtPos(doc, pos);
  if (classHit && pos >= classHit.from && pos <= classHit.to) return classHit;
  const w = wordAt(doc, pos);
  if (w && pos >= w.from && pos <= w.to) return w;
  return findTemplateBindAtPos(doc, pos);
}

/** 同步：仅用于下划线提示 */
export function findTargetAtPos(
  doc: string,
  pos: number,
  workspaceRoot: string | null,
  currentFile: string,
): NavTarget | null {
  const spec = findImportSpecAtPos(doc, pos);
  if (isLocalImportSpec(spec)) {
    const resolved = resolveImportCandidate(workspaceRoot, currentFile, spec);
    if (resolved) {
      return { path: resolved, line: 1, column: 1, kind: "import" };
    }
  }

  // class 属性里的 class 名（如 class="foo"）-> 直接查 CSS class 定义。
  // 优先于 findSymbolDefinition，因为 wordAt 不支持含 `-` 的 class 名。
  const classHit = findClassAttrAtPos(doc, pos);
  if (classHit && pos >= classHit.from && pos <= classHit.to) {
    const idx = indexDocumentSymbols(doc, currentFile);
    const defs = idx.get(classHit.word);
    if (defs?.length) {
      return { path: currentFile, line: defs[0].line, column: defs[0].column, kind: "symbol" };
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

  // 模板段内的标识符（@click="foo" / v-on:click / {{ foo }}），
  // 走与符号同样的下划线提示：找到 word 区间就提示。同步阶段不跨文件。
  const bindHit = findTemplateBindAtPos(doc, pos);
  if (bindHit) {
    return {
      path: currentFile,
      line: 1,
      column: 1,
      kind: "symbol",
    };
  }
  return null;
}

/** 异步：实际跳转（磁盘存在性校验 + 扩展名解析 + 跨文件符号） */
export async function findTargetAtPosAsync(
  doc: string,
  pos: number,
  workspaceRoot: string | null,
  currentFile: string,
): Promise<NavTarget | null> {
  const spec = findImportSpecAtPos(doc, pos);
  if (isLocalImportSpec(spec) && workspaceRoot) {
    const resolved = await resolveImportPath(workspaceRoot, currentFile, spec);
    if (resolved) {
      return { path: resolved, line: 1, column: 1, kind: "import" };
    }
  }

  // class 属性里的 class 名 -> 直接查 CSS class 定义（含 Vue <style> 段）
  const classHit = findClassAttrAtPos(doc, pos);
  if (classHit && pos >= classHit.from && pos <= classHit.to) {
    const idx = indexDocumentSymbols(doc, currentFile);
    const defs = idx.get(classHit.word);
    if (defs?.length) {
      return { path: currentFile, line: defs[0].line, column: defs[0].column, kind: "symbol" };
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

  // 当前文件未命中定义时，跨 import 链查找（同样适用于模板段标识符）
  if (workspaceRoot) {
    const hit = wordAtOrTemplateBind(doc, pos);
    if (hit && pos >= hit.from && pos <= hit.to) {
      const { workspaceSymbols } = await import("@/features/editor/workspaceSymbols");
      const cross = await workspaceSymbols.findDefinitionAcrossFiles(
        workspaceRoot,
        hit.word,
        currentFile,
      );
      if (cross) {
        return { path: cross.path, line: cross.line, column: cross.column, kind: "symbol" };
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

const linkMark = Decoration.mark({ class: "cm-nav-link" });

function createLinkDecorations(view: EditorView, handlers: NavigationHandlers): DecorationSet {
  const pos = view.state.selection.main.head;
  const doc = view.state.doc.toString();
  const hit = wordAt(doc, pos);
  const classHit = findClassAttrAtPos(doc, pos);
  const spec = findImportSpecAtPos(doc, pos);

  // import 路径上的任意位置都可提示；class 属性、符号则要求落在 word 上
  if (!spec && (!hit || pos < hit.from || pos > hit.to) && (!classHit || pos < classHit.from || pos > classHit.to)) {
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

  // class 属性里的 class 名优先用 classHit 区间（支持含 `-` 的 class 名）
  if (classHit && pos >= classHit.from && pos <= classHit.to) {
    return Decoration.set([linkMark.range(classHit.from, classHit.to)]);
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
