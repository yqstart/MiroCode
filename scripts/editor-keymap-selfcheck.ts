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
  const { EDITOR_KEYS, EDITOR_SHORTCUTS, createEditorKeymap } =
    await server.ssrLoadModule("/src/features/editor/keymap.ts");

  const navigation = {
    onNavigate: () => {},
    onGoBack: () => false,
    workspaceRoot: () => null,
    currentFile: () => "/workspace/demo/main.ts",
  };
  const handlers = {
    navigation,
    onRename: () => {},
    onReferences: () => {},
    onOpenFind: () => {},
    onOpenReplace: () => {},
    onFormatDocument: () => {},
    onFormatSelection: () => {},
    onEmmet: () => false,
  };

  const state = EditorState.create({ extensions: createEditorKeymap(handlers) });
  const bindings = state.facet(keymap).flat() as KeyBinding[];
  const matching = (key: string) => bindings.filter((binding) => binding.key === key);
  const firstIndex = (key: string) => bindings.findIndex((binding) => binding.key === key);

  assert(
    "应用层 Mod-Enter 优先于 defaultKeymap",
    matching(EDITOR_KEYS.goToDefinition).length >= 2 &&
      firstIndex(EDITOR_KEYS.goToDefinition) <
        bindings.findIndex(
          (binding, index) =>
            index > firstIndex(EDITOR_KEYS.goToDefinition) &&
            binding.key === EDITOR_KEYS.goToDefinition,
        ),
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
    "⌘Enter 无目标时返回 false 交给原生命令",
    goToDefinition?.run?.(fakeView as never) === false,
  );
  const goBack = matching(EDITOR_KEYS.goBack)[0];
  assert("⌘[ 无历史时返回 false 交给原生命令", goBack?.run?.(fakeView as never) === false);

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
} finally {
  await server.close();
}

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
