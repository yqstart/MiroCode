// ==================== 编辑器快捷键自测 ====================
// 通过 Vite SSR 加载 @ 别名模块，验证应用 keymap 位于 CM 原生 keymap 之前，
// 并覆盖跳转/返回无目标时的回退、诊断双向导航和高频原生命令保留。

import { createServer } from "vite";
import { resolve } from "node:path";
import { EditorState } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";

let failed = 0;
let passed = 0;
function assert(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  }
  else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { "@": resolve(root, "src") } },
});

try {
  const { EDITOR_KEYS, EDITOR_SHORTCUTS, createEditorKeymap, isReformatPhysicalKey } =
    await server.ssrLoadModule("/src/features/editor/keymap.ts");
  const { findImportedBindingAtPos, findTargetAtPos } =
    await server.ssrLoadModule("/src/features/editor/navigation.ts");
  const { indexDocumentSymbols } =
    await server.ssrLoadModule("/src/features/editor/documentSymbols.ts");

  const navigation = {
    onNavigate: () => {},
    onGoBack: () => false,
    onGoForward: () => false,
    workspaceRoot: () => null,
    currentFile: () => "/workspace/demo/main.ts",
  };
  let formattedDocument = 0;
  let formattedSelection = 0;
  let openedRecentFiles = 0;
  const handlers = {
    navigation,
    onRename: () => {},
    onReferences: () => {},
    onOpenFind: () => {},
    onOpenReplace: () => {},
    onOpenRecentFiles: () => {
      openedRecentFiles += 1;
    },
    onFormatDocument: () => {
      formattedDocument += 1;
    },
    onFormatSelection: () => {
      formattedSelection += 1;
    },
    onEmmet: () => false,
  };

  const state = EditorState.create({ extensions: createEditorKeymap(handlers) });
  const bindings = state.facet(keymap).flat() as KeyBinding[];
  const matching = (key: string) => bindings.filter((binding) => binding.key === key);
  const firstIndex = (key: string) => bindings.findIndex((binding) => binding.key === key);

  assert(
    "应用层注册 WebStorm Mod-b 声明跳转",
    matching(EDITOR_KEYS.goToDefinition).length >= 1 &&
      firstIndex(EDITOR_KEYS.goToDefinition) >= 0,
  );
  assert(
    "应用层 Mod-[ 优先于 indentLess",
    matching(EDITOR_KEYS.goBack).length >= 2 &&
      firstIndex(EDITOR_KEYS.goBack) <
        bindings.findIndex(
          (binding, index) =>
            index > firstIndex(EDITOR_KEYS.goBack) && binding.key === EDITOR_KEYS.goBack,
        ),
  );

  const fakeView = {
    state: EditorState.create({ doc: "// no navigation target\n" }),
  };
  const goToDefinition = matching(EDITOR_KEYS.goToDefinition)[0];
  assert(
    "⌘B 无目标时返回 false 交给原生命令",
    goToDefinition?.run?.(fakeView as never) === false,
  );
  const goBack = matching(EDITOR_KEYS.goBack)[0];
  assert("⌘[ 无历史时返回 false 交给原生命令", goBack?.run?.(fakeView as never) === false);
  const goForward = matching(EDITOR_KEYS.goForward)[0];
  assert("⌘] 无历史时返回 false 交给原生命令", goForward?.run?.(fakeView as never) === false);

  const recentFiles = matching(EDITOR_KEYS.recentFiles)[0];
  recentFiles?.run?.(fakeView as never);
  assert("编辑器内 ⌘E 打开最近文件", openedRecentFiles === 1);

  const semanticCandidateView = {
    state: EditorState.create({ doc: "memberCall", selection: { anchor: 3 } }),
  };
  assert(
    "标识符即使轻量索引未命中也会尝试语义跳转",
    goToDefinition?.run?.(semanticCandidateView as never) === true,
  );

  const namedImport = 'import { helper } from "./helper";';
  const symbolTarget = findTargetAtPos(
    namedImport,
    namedImport.indexOf("helper") + 2,
    "/workspace/demo",
    "/workspace/demo/main.ts",
  );
  const pathTarget = findTargetAtPos(
    namedImport,
    namedImport.indexOf("./helper") + 2,
    "/workspace/demo",
    "/workspace/demo/main.ts",
  );
  assert(
    "命名 import 上的标识符不会被误判成模块路径",
    symbolTarget?.kind !== "import" && pathTarget?.kind === "import",
  );
  const multilineImport = [
    "import {",
    "  sourceName as localName,",
    "  type NavigationHandlers,",
    '} from "@/features/editor/navigation";',
  ].join("\n");
  assert(
    "多行 import 绑定可直接映射到源导出",
    findImportedBindingAtPos(
      multilineImport,
      multilineImport.indexOf("localName") + 2,
    )?.importedName === "sourceName" &&
      findImportedBindingAtPos(
        multilineImport,
        multilineImport.indexOf("NavigationHandlers") + 2,
      )?.importedName === "NavigationHandlers",
  );
  assert(
    "TypeScript 展开调用不会被误索引成 CSS class 定义",
    !indexDocumentSymbols(
      "const bindings = [...goToDefinitionKeymap(handlers)];",
      "/workspace/demo/keymap.ts",
    ).has("goToDefinitionKeymap") &&
      indexDocumentSymbols(".card { color: red; }", "/workspace/demo/theme.css").has("card"),
  );

  const reformat = matching(EDITOR_KEYS.reformatCode)[0];
  const selectionView = {
    state: EditorState.create({ doc: "const value=1", selection: { anchor: 0, head: 5 } }),
  };
  const documentView = {
    state: EditorState.create({ doc: "const value=1" }),
  };
  reformat?.run?.(selectionView as never);
  reformat?.run?.(documentView as never);
  assert(
    "WebStorm 重排快捷键有选区时只格式化选区",
    formattedSelection === 1 && formattedDocument === 1,
  );
  assert(
    "macOS Option+L 产生特殊字符时仍按物理键识别格式化",
    isReformatPhysicalKey({
      metaKey: true,
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      code: "KeyL",
    }),
  );

  const diagnostic = matching(EDITOR_KEYS.nextDiagnostic)[0];
  assert(
    "F8 与 Shift-F8 共用诊断导航绑定",
    typeof diagnostic?.run === "function" && typeof diagnostic.shift === "function",
  );
  assert(
    "⌘K ⌘F 注册为连续 chord",
    matching(EDITOR_KEYS.formatSelection).length === 1,
  );

  const nativeKeys = [
    "Mod-d",
    "Mod-Shift-l",
    "Alt-ArrowUp",
    "Alt-ArrowDown",
    "Shift-Alt-ArrowUp",
    "Shift-Alt-ArrowDown",
    "Mod-Alt-ArrowUp",
    "Mod-Alt-ArrowDown",
    "Shift-Mod-k",
    "Mod-/",
  ];
  for (const key of nativeKeys) {
    assert(`保留原生 ${key}`, matching(key).length > 0);
  }

  const ids = EDITOR_SHORTCUTS.map((shortcut: { id: string }) => shortcut.id);
  assert("快捷键元数据 id 唯一", new Set(ids).size === ids.length);
  assert("元数据覆盖选区格式化", EDITOR_SHORTCUTS.some((item: { id: string }) => item.id === "formatSelection"));
  assert("元数据覆盖前进导航", EDITOR_SHORTCUTS.some((item: { id: string }) => item.id === "goForward"));
} finally {
  await server.close();
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
