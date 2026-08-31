import { EditorView, ViewPlugin, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension, Text } from "@codemirror/state";
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
import {
  ensureTypeScriptProgram,
  openedContent,
  tsService,
} from "@/features/editor/typeService";
import { createVueScriptContext, isInVueScript } from "@/features/editor/vueScript";
import { readTextFile } from "@/shared/fs";

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

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const safe = Math.max(0, Math.min(text.length, offset));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < safe; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: safe - lineStart + 1 };
}

async function findTypeScriptDefinition(
  doc: string,
  pos: number,
  root: string,
  currentFile: string,
): Promise<NavTarget | null> {
  const hit = wordAt(doc, pos);
  if (!hit || pos < hit.from || pos > hit.to) return null;
  const isVue = /\.vue$/i.test(currentFile);
  const inVueScript = isVue && isInVueScript(doc, pos);
  if (isVue && !inVueScript) return null;
  const virtual = inVueScript ? createVueScriptContext(currentFile, doc) : null;
  const serviceFile = virtual?.fileName ?? currentFile;
  const serviceText = virtual?.text ?? doc;
  if (!(await ensureTypeScriptProgram(root, serviceFile, serviceText))) return null;
  const definitions = tsService.definitionsAt(serviceFile, pos);
  for (const definition of definitions) {
    const path = definition.fileName === serviceFile ? currentFile : definition.fileName;
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const normalizedPath = path.replace(/\\/g, "/").toLowerCase();
    if (!(normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`))) continue;
    let targetText = path === currentFile ? doc : null;
    if (targetText === null) {
      try {
        targetText = await readTextFile(root, path);
      } catch {
        continue;
      }
    }
    const location = offsetToLineColumn(targetText, definition.textSpan.start);
    return { path, line: location.line, column: location.column, kind: "symbol" };
  }
  return null;
}

function findImportSpecAtPos(doc: string, pos: number): string | null {
  for (const re of [IMPORT_RE, PATH_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(doc))) {
      const spec = match[1];
      const specOffset = match[0].lastIndexOf(spec);
      if (specOffset < 0) continue;
      const start = match.index + specOffset;
      const end = start + spec.length;
      if (pos >= start && pos <= end) return spec;
    }
  }
  return null;
}

/**
 * 光标位于本地 ES import 绑定时，返回它在源模块中的导出名。
 * 这条路径不需要先启动完整 TypeScript 程序，因此首次 ⌘B 也能即时跳转；
 * 别名 `import { source as local }` 会正确映射回 `source`。
 */
export function findImportedBindingAtPos(
  doc: string,
  pos: number,
): { spec: string; importedName: string } | null {
  const hit = wordAt(doc, pos);
  if (!hit || pos < hit.from || pos > hit.to) return null;
  const re = new RegExp(IMPORT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(doc))) {
    if (!/^\s*import\b/.test(match[0])) continue;
    const spec = match[1];
    if (!isLocalImportSpec(spec)) continue;
    const specOffset = match[0].lastIndexOf(spec);
    const importOffset = match[0].search(/\bimport\b/);
    const fromOffset = match[0].lastIndexOf("from", specOffset);
    if (specOffset < 0 || importOffset < 0 || fromOffset < 0) continue;
    const clauseFrom = match.index + importOffset + "import".length;
    const clauseTo = match.index + fromOffset;
    if (hit.from < clauseFrom || hit.to > clauseTo) continue;

    const clause = match[0]
      .slice(importOffset + "import".length, fromOffset)
      .trim()
      .replace(/^type\s+/, "");
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1];
    if (named) {
      for (const item of named.split(",")) {
        const binding = item
          .trim()
          .replace(/^type\s+/, "")
          .match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!binding) continue;
        const importedName = binding[1];
        const localName = binding[2] ?? importedName;
        if (hit.word === localName || hit.word === importedName) {
          return { spec, importedName };
        }
      }
    }

    const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (namespace?.[1] === hit.word) return { spec, importedName: "*" };

    const defaultName = clause.split(/[,\s]/, 1)[0];
    if (defaultName === hit.word) return { spec, importedName: "default" };
  }
  return null;
}

async function findDirectImportedDefinition(
  doc: string,
  pos: number,
  root: string,
  currentFile: string,
): Promise<NavTarget | null> {
  const binding = findImportedBindingAtPos(doc, pos);
  if (!binding) return null;
  const resolved = await resolveImportPath(root, currentFile, binding.spec);
  if (!resolved) return null;
  if (binding.importedName === "*") {
    return { path: resolved, line: 1, column: 1, kind: "symbol" };
  }
  const text = (await openedContent(resolved)) ?? (await readTextFile(root, resolved));
  const definition = indexDocumentSymbols(text, resolved).get(binding.importedName)?.[0];
  if (!definition) return null;
  return {
    path: resolved,
    line: definition.line,
    column: definition.column,
    kind: "symbol",
  };
}

/**
 * 行级 import spec 探测：import/require/from 及路径引用都是单行结构，
 * 装饰计算只扫光标所在行，避免每次光标移动对全文档跑正则。
 * 返回 spec 及其精确区间（供直接画下划线，省去二次定位）。
 */
function findImportSpecOnLine(
  lineText: string,
  lineStart: number,
  pos: number,
): { spec: string; from: number; to: number } | null {
  for (const re of [IMPORT_RE, PATH_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText))) {
      const spec = m[1];
      const specOffset = m[0].lastIndexOf(spec);
      if (specOffset < 0) continue;
      const start = lineStart + m.index + specOffset;
      const end = start + spec.length;
      if (pos < start || pos > end) continue;
      return {
        spec,
        from: start,
        to: end,
      };
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

/** 行级模板绑定探测（装饰热路径用）：`@click="foo"` / `{{ foo }}` 为单行结构 */
function findTemplateBindOnLine(
  lineText: string,
  lineStart: number,
  pos: number,
): { word: string; from: number; to: number } | null {
  TEMPLATE_BIND_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEMPLATE_BIND_RE.exec(lineText))) {
    const name = m[1];
    if (!name) continue;
    const nameOffset = m[0].indexOf(name);
    if (nameOffset < 0) continue;
    const from = lineStart + m.index + nameOffset;
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

/** 行级 class 属性探测（装饰热路径用，class 属性为单行结构） */
function findClassAttrOnLine(
  lineText: string,
  lineStart: number,
  pos: number,
): { word: string; from: number; to: number } | null {
  CLASS_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLASS_ATTR_RE.exec(lineText))) {
    const valueStart = lineStart + m.index + m[0].indexOf(m[1]);
    const valueEnd = valueStart + m[1].length;
    if (pos < valueStart || pos > valueEnd) continue;
    let cur = valueStart;
    for (const part of m[1].split(/\s+/)) {
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

  // 直接 import 绑定优先走轻量、确定性的目标文件索引。首次按 ⌘B 时无需
  // 等待 5MB TypeScript 运行时和整条 import 闭包加载，失败再进入语义路径。
  if (workspaceRoot) {
    try {
      const direct = await findDirectImportedDefinition(
        doc,
        pos,
        workspaceRoot,
        currentFile,
      );
      if (direct) return direct;
    } catch {
      // 文件刚被移动/删除时继续尝试 TypeScript 与工作区索引降级路径。
    }
  }

  // JS/TS/Vue script 优先走真实 TypeScript definition；失败后再走正则符号索引。
  if (workspaceRoot) {
    try {
      const semantic = await findTypeScriptDefinition(
        doc,
        pos,
        workspaceRoot,
        currentFile,
      );
      if (semantic) return semantic;
    } catch {
      // 类型服务懒加载/解析失败时继续使用轻量路径和符号索引。
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
  /** 返回成功时返回 true；没有历史时返回 false，让原生编辑命令继续处理。 */
  onGoBack: () => boolean;
  onGoForward: () => boolean;
  workspaceRoot: () => string | null;
  currentFile: () => string;
}

function canAttemptNavigation(doc: string, pos: number): boolean {
  return Boolean(
    findImportSpecAtPos(doc, pos) ||
      findClassAttrAtPos(doc, pos) ||
      wordAtOrTemplateBind(doc, pos),
  );
}

const linkMark = Decoration.mark({ class: "cm-nav-link" });

/**
 * 计算导航下划线装饰（输入/光标热路径）。
 * 只扫光标所在行（import/class/模板绑定均为单行结构），符号判定走
 * 记忆化的全文档索引；纯光标移动时 doc 字符串引用不变，索引 O(1) 命中。
 */
function computeLinkDecorations(
  view: EditorView,
  handlers: NavigationHandlers,
  docText: string,
): DecorationSet {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const specHit = findImportSpecOnLine(line.text, line.from, pos);
  const classHit = findClassAttrOnLine(line.text, line.from, pos);
  const hit = wordAt(docText, pos);
  const onWord = !!hit && pos >= hit.from && pos <= hit.to;
  const onClass = !!classHit && pos >= classHit.from && pos <= classHit.to;
  // 光标不在 import 路径 / 标识符 / class 名上：直接不画，跳过索引查询
  if (!specHit && !onWord && !onClass) return Decoration.none;

  // import 路径：同步解析（不查磁盘），命中才画
  if (specHit && isLocalImportSpec(specHit.spec)) {
    const resolved = resolveImportCandidate(
      handlers.workspaceRoot(),
      handlers.currentFile(),
      specHit.spec,
    );
    if (resolved) {
      return Decoration.set([linkMark.range(specHit.from, specHit.to)]);
    }
  }

  const doc = docText;
  const file = handlers.currentFile();
  const index = indexDocumentSymbols(doc, file);

  // class 属性里的 class 名优先用 classHit 区间（支持含 `-` 的 class 名）
  if (onClass && index.get(classHit.word)?.length) {
    return Decoration.set([linkMark.range(classHit.from, classHit.to)]);
  }

  // 普通标识符：符号索引命中或模板段绑定引用（@click / {{ }}）命中则画
  if (onWord) {
    if (index.get(hit.word)?.length) {
      return Decoration.set([linkMark.range(hit.from, hit.to)]);
    }
    const bindHit = findTemplateBindOnLine(line.text, line.from, pos);
    if (bindHit) {
      return Decoration.set([linkMark.range(hit.from, hit.to)]);
    }
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
      // doc 字符串按 Text 引用缓存：纯光标移动（selectionSet 无 docChanged）
      // 时 update.state.doc 是同一 Text 实例，直接复用字符串，跳过 toString
      private lastDocText: Text;
      private lastDocString: string;

      constructor(view: EditorView) {
        this.lastDocText = view.state.doc;
        this.lastDocString = view.state.doc.toString();
        this.decorations = computeLinkDecorations(view, handlers, this.lastDocString);
      }

      update(update: import("@codemirror/view").ViewUpdate) {
        if (!update.selectionSet && !update.docChanged) return;
        if (update.state.doc !== this.lastDocText) {
          this.lastDocText = update.state.doc;
          this.lastDocString = update.state.doc.toString();
        }
        this.decorations = computeLinkDecorations(update.view, handlers, this.lastDocString);
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
        if (!canAttemptNavigation(view.state.doc.toString(), pos)) return false;
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
  const run = (view: EditorView) => {
    const pos = view.state.selection.main.head;
    if (!canAttemptNavigation(view.state.doc.toString(), pos)) return false;
    void navigateFromView(view, handlers, pos);
    return true;
  };
  return [
    {
      key: "Mod-b",
      run,
    },
    {
      key: "Mod-Enter",
      run,
    },
    {
      key: "F12",
      run,
    },
  ];
}

export function goBackKeymap(handlers: NavigationHandlers) {
  return {
    key: "Mod-[",
    run() {
      return handlers.onGoBack();
    },
  };
}

export function goForwardKeymap(handlers: NavigationHandlers) {
  return {
    key: "Mod-]",
    run() {
      return handlers.onGoForward();
    },
  };
}
