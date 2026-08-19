/**
 * 编辑器会话恢复。
 *
 * 只按工作区根目录隔离数据，不把会话内容混进应用设置。干净标签只保存
 * 路径/光标/固定状态；有未保存改动的标签额外保存恢复所需的缓冲区快照，
 * 让重启后的恢复行为接近 VS Code 的 hot exit，同时不保存完整项目文件。
 */

const STORAGE_PREFIX = "mirocode.editor-session.v2:";
const MAX_TABS = 60;
const MAX_DIRTY_TABS = 12;
const MAX_CONTENT_CHARS = 1_000_000;

export interface EditorSessionTab {
  path: string;
  cursor: { line: number; column: number };
  pinned: boolean;
  dirty?: boolean;
  content?: string;
  original?: string;
}

export interface EditorSession {
  tabs: EditorSessionTab[];
  activePath: string | null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isPathInRoot(root: string, path: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  if (!normalizedRoot || !normalizedPath) return false;
  const rootKey = normalizedRoot.toLowerCase();
  const pathKey = normalizedPath.toLowerCase();
  return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
}

function storageKey(root: string): string {
  return `${STORAGE_PREFIX}${normalizePath(root)}`;
}

function validCursor(value: unknown): value is { line: number; column: number } {
  if (!value || typeof value !== "object") return false;
  const cursor = value as { line?: unknown; column?: unknown };
  return (
    typeof cursor.line === "number" &&
    Number.isFinite(cursor.line) &&
    cursor.line >= 1 &&
    typeof cursor.column === "number" &&
    Number.isFinite(cursor.column) &&
    cursor.column >= 1
  );
}

function parseSession(raw: string, root: string): EditorSession | null {
  try {
    const parsed = JSON.parse(raw) as {
      tabs?: unknown;
      activePath?: unknown;
    };
    if (!Array.isArray(parsed.tabs)) return null;

    const tabs: EditorSessionTab[] = [];
    for (const item of parsed.tabs.slice(0, MAX_TABS)) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<EditorSessionTab>;
      if (
        typeof candidate.path !== "string" ||
        !isPathInRoot(root, candidate.path) ||
        !validCursor(candidate.cursor)
      ) {
        continue;
      }
      const recovered: EditorSessionTab = {
        path: candidate.path,
        cursor: {
          line: Math.max(1, Math.floor(candidate.cursor.line)),
          column: Math.max(1, Math.floor(candidate.cursor.column)),
        },
        pinned: candidate.pinned === true,
      };
      if (
        candidate.dirty === true &&
        typeof candidate.content === "string" &&
        typeof candidate.original === "string" &&
        candidate.content.length <= MAX_CONTENT_CHARS &&
        candidate.original.length <= MAX_CONTENT_CHARS
      ) {
        recovered.dirty = true;
        recovered.content = candidate.content;
        recovered.original = candidate.original;
      }
      tabs.push(recovered);
    }

    const activePath =
      typeof parsed.activePath === "string" &&
      tabs.some((tab) => tab.path === parsed.activePath)
        ? parsed.activePath
        : tabs[0]?.path ?? null;
    return { tabs, activePath };
  } catch {
    return null;
  }
}

export function loadEditorSession(root: string): EditorSession | null {
  if (!root) return null;
  try {
    const raw = localStorage.getItem(storageKey(root));
    return raw ? parseSession(raw, root) : null;
  } catch {
    return null;
  }
}

export function saveEditorSession(root: string, session: EditorSession): void {
  if (!root) return;
  try {
    const dirtyTabs = session.tabs.filter((tab) => tab.dirty).slice(0, MAX_DIRTY_TABS);
    const dirtyPaths = new Set(dirtyTabs.map((tab) => tab.path));
    const tabs = session.tabs.slice(0, MAX_TABS).map((tab) => {
      const saved: EditorSessionTab = {
        path: tab.path,
        cursor: {
          line: Math.max(1, Math.floor(tab.cursor.line)),
          column: Math.max(1, Math.floor(tab.cursor.column)),
        },
        pinned: tab.pinned === true,
      };
      if (
        dirtyPaths.has(tab.path) &&
        typeof tab.content === "string" &&
        typeof tab.original === "string" &&
        tab.content.length <= MAX_CONTENT_CHARS &&
        tab.original.length <= MAX_CONTENT_CHARS
      ) {
        saved.dirty = true;
        saved.content = tab.content;
        saved.original = tab.original;
      }
      return saved;
    });
    localStorage.setItem(
      storageKey(root),
      JSON.stringify({
        tabs,
        activePath: tabs.some((tab) => tab.path === session.activePath)
          ? session.activePath
          : tabs[0]?.path ?? null,
      } satisfies EditorSession),
    );
  } catch {
    // 隐私模式 / localStorage 容量不足不应阻断编辑器工作。
  }
}
