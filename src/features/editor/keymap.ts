import { closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  type KeyBinding,
} from "@codemirror/view";
import {
  goBackKeymap,
  goToDefinitionKeymap,
  type NavigationHandlers,
} from "@/features/editor/navigation";

/** 编辑器应用层快捷键的唯一键名来源。CodeMirror 会在注册时规范化大小写。 */
export const EDITOR_KEYS = {
  goToDefinition: "Mod-Enter",
  goToDefinitionF12: "F12",
  goBack: "Mod-[",
  rename: "F2",
  references: "Shift-F12",
  openFind: "Mod-f",
  openReplaceMac: "Mod-Alt-f",
  openReplace: "Mod-h",
  formatDocument: "Shift-Alt-f",
  formatSelection: "Mod-k Mod-f",
  nextDiagnostic: "F8",
  previousDiagnostic: "Shift-F8",
  emmet: "Tab",
} as const;

export type ShortcutToken = "mod" | "alt" | "shift" | string;
export type ShortcutStroke = ShortcutToken[];

export interface EditorShortcutDescriptor {
  id: string;
  /** CodeMirror key binding 语法；chord 用空格分隔。 */
  key: string;
  /** 设置页使用的跨平台展示形式。一个元素代表一个 chord stroke。 */
  strokes: ShortcutStroke[];
  labelKey: string;
}

/**
 * 设置页与编辑器 keymap 共用的快捷键说明。
 * 这里只登记编辑器内的高频操作；文件、终端、侧栏等工作台快捷键仍由设置页维护。
 */
export const EDITOR_SHORTCUTS: EditorShortcutDescriptor[] = [
  {
    id: "goToDefinition",
    key: EDITOR_KEYS.goToDefinition,
    strokes: [["mod", "Enter"]],
    labelKey: "settings.shortcutGoToDef",
  },
  {
    id: "goToDefinitionF12",
    key: EDITOR_KEYS.goToDefinitionF12,
    strokes: [["F12"]],
    labelKey: "settings.shortcutGoToDef",
  },
  {
    id: "goBack",
    key: EDITOR_KEYS.goBack,
    strokes: [["mod", "["]],
    labelKey: "settings.shortcutGoBack",
  },
  {
    id: "rename",
    key: EDITOR_KEYS.rename,
    strokes: [["F2"]],
    labelKey: "settings.shortcutRename",
  },
  {
    id: "references",
    key: EDITOR_KEYS.references,
    strokes: [["shift", "F12"]],
    labelKey: "settings.shortcutReferences",
  },
  {
    id: "formatDocument",
    key: EDITOR_KEYS.formatDocument,
    strokes: [["shift", "alt", "F"]],
    labelKey: "settings.shortcutFormat",
  },
  {
    id: "formatSelection",
    key: EDITOR_KEYS.formatSelection,
    strokes: [["mod", "K"], ["mod", "F"]],
    labelKey: "settings.shortcutFormatSelection",
  },
  {
    id: "selectNextOccurrence",
    key: "Mod-d",
    strokes: [["mod", "D"]],
    labelKey: "settings.shortcutSelectNextOccurrence",
  },
  {
    id: "selectAllOccurrences",
    key: "Mod-Shift-l",
    strokes: [["mod", "shift", "L"]],
    labelKey: "settings.shortcutSelectAllOccurrences",
  },
  {
    id: "moveLineUp",
    key: "Alt-ArrowUp",
    strokes: [["alt", "↑"]],
    labelKey: "settings.shortcutMoveLineUp",
  },
  {
    id: "moveLineDown",
    key: "Alt-ArrowDown",
    strokes: [["alt", "↓"]],
    labelKey: "settings.shortcutMoveLineDown",
  },
  {
    id: "copyLineUp",
    key: "Shift-Alt-ArrowUp",
    strokes: [["shift", "alt", "↑"]],
    labelKey: "settings.shortcutCopyLineUp",
  },
  {
    id: "copyLineDown",
    key: "Shift-Alt-ArrowDown",
    strokes: [["shift", "alt", "↓"]],
    labelKey: "settings.shortcutCopyLineDown",
  },
  {
    id: "addCursorAbove",
    key: "Mod-Alt-ArrowUp",
    strokes: [["mod", "alt", "↑"]],
    labelKey: "settings.shortcutAddCursorAbove",
  },
  {
    id: "addCursorBelow",
    key: "Mod-Alt-ArrowDown",
    strokes: [["mod", "alt", "↓"]],
    labelKey: "settings.shortcutAddCursorBelow",
  },
  {
    id: "deleteLine",
    key: "Shift-Mod-k",
    strokes: [["shift", "mod", "K"]],
    labelKey: "settings.shortcutDeleteLine",
  },
  {
    id: "toggleComment",
    key: "Mod-/",
    strokes: [["mod", "/"]],
    labelKey: "settings.shortcutToggleComment",
  },
  {
    id: "nextDiagnostic",
    key: EDITOR_KEYS.nextDiagnostic,
    strokes: [["F8"]],
    labelKey: "settings.shortcutNextDiagnostic",
  },
  {
    id: "previousDiagnostic",
    key: EDITOR_KEYS.previousDiagnostic,
    strokes: [["shift", "F8"]],
    labelKey: "settings.shortcutPreviousDiagnostic",
  },
  {
    id: "emmet",
    key: EDITOR_KEYS.emmet,
    strokes: [["Tab"]],
    labelKey: "settings.shortcutEmmet",
  },
];

export interface EditorKeymapHandlers {
  navigation: NavigationHandlers;
  onRename: (view: EditorView) => void;
  onReferences: (view: EditorView) => void;
  onOpenFind: (view: EditorView) => void;
  onOpenReplace: (view: EditorView) => void;
  onFormatDocument: () => void;
  onFormatSelection: (view: EditorView) => void;
  onEmmet: (view: EditorView) => boolean;
}

/**
 * 构建编辑器 keymap。
 * 应用层命令必须通过 Prec.highest 注册，避免被 defaultKeymap 中同键的原生命令抢先消费。
 */
export function createEditorKeymap(handlers: EditorKeymapHandlers): Extension {
  const appBindings: KeyBinding[] = [
    ...goToDefinitionKeymap(handlers.navigation),
    goBackKeymap(handlers.navigation),
    {
      key: EDITOR_KEYS.rename,
      run: (view) => {
        handlers.onRename(view);
        return true;
      },
    },
    {
      key: EDITOR_KEYS.references,
      run: (view) => {
        handlers.onReferences(view);
        return true;
      },
    },
    {
      key: EDITOR_KEYS.openFind,
      run: (view) => {
        handlers.onOpenFind(view);
        return true;
      },
    },
    {
      key: EDITOR_KEYS.openReplaceMac,
      run: (view) => {
        handlers.onOpenReplace(view);
        return true;
      },
    },
    {
      key: EDITOR_KEYS.openReplace,
      run: (view) => {
        handlers.onOpenReplace(view);
        return true;
      },
    },
    {
      key: EDITOR_KEYS.formatDocument,
      run: () => {
        handlers.onFormatDocument();
        return true;
      },
    },
    {
      key: EDITOR_KEYS.formatSelection,
      run: (view) => {
        handlers.onFormatSelection(view);
        return true;
      },
    },
  ];

  const nativeBindings: KeyBinding[] = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    {
      key: EDITOR_KEYS.nextDiagnostic,
      run: nextDiagnostic,
      shift: previousDiagnostic,
      preventDefault: true,
    },
    {
      key: EDITOR_KEYS.emmet,
      run: (view) => handlers.onEmmet(view),
    },
    indentWithTab,
  ];

  return [
    Prec.highest(keymap.of(appBindings)),
    keymap.of(nativeBindings),
  ];
}
