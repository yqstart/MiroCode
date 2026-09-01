import {
  dirname,
  listDir,
  pathExists,
  readTextFile,
  relativePath,
  resolveRelativePath,
  resolveAliasPath,
  writeTextFile,
  normalizeAbsPath,
  isPathUnder,
  type DirEntryInfo,
} from "@/shared/fs";

export const IMPORT_RE =
  /(?:import\s+(?:[\w*{}\s,]+\s+from\s+|)|require\s*\(\s*|from\s+)['"]([^'"]+)['"]/g;

export const PATH_RE = /['"](\.{1,2}\/[^'"]+)['"]/g;

/**
 * Vue 模板绑定：把 `@click="foo"` / `v-on:click="foo"` / `{{ foo }}` / `{{ foo.bar }}`
 * 等视作对标识符 `foo` 的引用，参与 go-to-definition。
 * 注意：只取首个裸标识符（`{{ a.b.c }}` -> `a`），避免长链查找歧义。
 */
export const TEMPLATE_BIND_RE = /(?:@[A-Za-z][\w-]*\s*=\s*["']|v-on:[A-Za-z][\w-]*\s*=\s*["']|\{\{)\s*([A-Za-z_$][\w$]*)/g;

/**
 * HTML/Vue class 属性：`class="foo bar"` / `:class="{ foo: true }"` / `class='foo'`。
 * 全局匹配，每次取出一个 class 名（含连字符，如 `my-class`）。
 * 用于 go-to-definition：template 里 `class="foo"` 的 `foo` 跳到 `<style>` 段 `.foo`。
 */
export const CLASS_ATTR_RE = /class\s*=\s*["']([^"']+)["']/g;

const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/index.vue",
  "/index.css",
  "/index.scss",
  "/index.sass",
  "/index.less",
  "",
];

const SCAN_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "vue",
  "css",
  "scss",
  "sass",
  "less",
  "json",
  "md",
  "markdown",
]);

export interface ImportPatch {
  id: string;
  file: string;
  line: number;
  oldSpec: string;
  newSpec: string;
  start: number;
  end: number;
  preview: string;
}

function importTargetBase(currentFile: string, spec: string, root?: string): string | null {
  // 路径别名（如 `@/foo`）：映射到工作区根下的 src 等目录
  if (spec.startsWith("@/") && root) {
    const aliased = resolveAliasPath(root, spec);
    return aliased;
  }
  return resolveRelativePath(dirname(currentFile), spec);
}

function underWorkspace(root: string, path: string): boolean {
  return isPathUnder(root, path);
}

/** 该 spec 是否可能是本地模块（相对路径或路径别名），即值得做磁盘解析 */
function isLocalSpec(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("@/");
}

/** 同步解析（下划线提示用；不查磁盘，优先带扩展名猜测） */
export function resolveImportCandidate(
  workspaceRoot: string | null,
  currentFile: string,
  spec: string,
): string | null {
  if (!workspaceRoot || !isLocalSpec(spec)) return null;
  const target = importTargetBase(currentFile, spec, workspaceRoot);
  if (!target) return null;
  if (!underWorkspace(workspaceRoot, target) && !underWorkspace(workspaceRoot, dirname(target))) {
    return null;
  }

  const baseName = target.split("/").pop() ?? "";
  const hasExt = /\.\w+$/.test(baseName);
  if (hasExt) {
    return underWorkspace(workspaceRoot, target) ? target : null;
  }

  // 无扩展名时不要返回裸路径（打开会失败）；猜最常见扩展供下划线提示
  for (const ext of RESOLVE_EXTENSIONS) {
    if (!ext) continue;
    const candidate = `${target}${ext}`;
    if (underWorkspace(workspaceRoot, candidate)) return candidate;
  }
  return underWorkspace(workspaceRoot, target) ? target : null;
}

/** 解析本地 import（相对路径或 `@/` 别名）为工作区内绝对路径（需磁盘存在） */
export async function resolveImportPath(
  root: string,
  currentFile: string,
  spec: string,
): Promise<string | null> {
  if (!isLocalSpec(spec)) return null;
  const target = importTargetBase(currentFile, spec, root);
  if (!target) return null;

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `${target}${ext}`;
    if (!underWorkspace(root, candidate) && ext !== "") continue;
    try {
      if (!(await pathExists(root, candidate))) continue;
      return candidate;
    } catch {
      // 工作区校验失败等
    }
  }
  return null;
}

function stripKnownExtensions(path: string): string {
  for (const ext of [
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".vue",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".json",
  ]) {
    if (path.endsWith(ext)) return path.slice(0, -ext.length);
  }
  if (path.endsWith("/index")) return path.slice(0, -"/index".length);
  return path;
}

function specHadExtension(spec: string): boolean {
  const base = spec.split("/").pop() ?? spec;
  return /\.\w+$/.test(base);
}

function toRelativeSpec(
  importerFile: string,
  targetAbs: string,
  oldSpec: string,
): string {
  let rel = relativePath(dirname(importerFile), targetAbs);
  if (!specHadExtension(oldSpec)) {
    rel = stripKnownExtensions(rel);
  }
  return rel;
}

function remapResolved(
  resolved: string,
  fromAbs: string,
  toAbs: string,
  isDir: boolean,
): string | null {
  const r = normalizeAbsPath(resolved);
  const from = normalizeAbsPath(fromAbs);
  const to = normalizeAbsPath(toAbs);
  if (isDir) {
    if (r === from || r.startsWith(`${from}/`)) {
      return r === from ? to : `${to}${r.slice(from.length)}`;
    }
    return null;
  }
  return r === from ? to : null;
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function previewLine(content: string, line: number): string {
  const lines = content.split("\n");
  return (lines[line - 1] ?? "").trim();
}

async function listScannableFiles(
  root: string,
  dir: string,
  extraIgnores: string[],
  out: string[],
): Promise<void> {
  let entries: DirEntryInfo[];
  try {
    entries = await listDir(root, dir, extraIgnores);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDir) {
      await listScannableFiles(root, entry.path, extraIgnores, out);
      continue;
    }
    const ext = entry.name.includes(".")
      ? entry.name.split(".").pop()?.toLowerCase() ?? ""
      : "";
    if (SCAN_EXTENSIONS.has(ext)) {
      out.push(entry.path);
    }
  }
}

/** 扫描移动后需更新的相对 import */
export async function scanImportReferences(
  root: string,
  fromAbs: string,
  toAbs: string,
  isDir: boolean,
  extraIgnores: string[] = [],
): Promise<ImportPatch[]> {
  const files: string[] = [];
  await listScannableFiles(root, root, extraIgnores, files);

  const patches: ImportPatch[] = [];
  let seq = 0;

  for (const file of files) {
    let content: string;
    try {
      content = await readTextFile(root, file);
    } catch {
      continue;
    }

    for (const re of [IMPORT_RE, PATH_RE]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content))) {
        const spec = match[1];
        if (!isLocalSpec(spec)) continue;
        const resolved = await resolveImportPath(root, file, spec);
        if (!resolved) continue;
        const newResolved = remapResolved(resolved, fromAbs, toAbs, isDir);
        if (!newResolved) continue;

        const newSpec = toRelativeSpec(file, newResolved, spec);
        if (newSpec === spec) continue;

        const specStart = match.index + match[0].indexOf(spec);
        const specEnd = specStart + spec.length;
        seq += 1;
        patches.push({
          id: `${file}:${seq}`,
          file,
          line: lineAt(content, specStart),
          oldSpec: spec,
          newSpec,
          start: specStart,
          end: specEnd,
          preview: previewLine(content, lineAt(content, specStart)),
        });
      }
    }
  }

  return patches;
}

/** 写回引用变更并同步已打开编辑器 */
export async function applyImportPatches(
  root: string,
  patches: ImportPatch[],
  syncEditor: (path: string, content: string) => void,
  markWrite: (path: string) => void,
): Promise<number> {
  const byFile = new Map<string, ImportPatch[]>();
  for (const patch of patches) {
    const list = byFile.get(patch.file) ?? [];
    list.push(patch);
    byFile.set(patch.file, list);
  }

  let applied = 0;
  for (const [file, filePatches] of byFile) {
    let content = await readTextFile(root, file);
    const sorted = [...filePatches].sort((a, b) => b.start - a.start);
    for (const patch of sorted) {
      // 补丁偏移来自扫描时的内容快照：文件在扫描后被编辑过则偏移失效，
      // 直接切片拼接会写坏文件。以 oldSpec 复核，不匹配则跳过该补丁
      if (content.slice(patch.start, patch.end) !== patch.oldSpec) {
        continue;
      }
      content =
        content.slice(0, patch.start) +
        patch.newSpec +
        content.slice(patch.end);
      applied += 1;
    }
    markWrite(file);
    await writeTextFile(root, file, content);
    syncEditor(file, content);
  }
  return applied;
}

export function validateMoveTarget(
  from: string,
  toParent: string,
  root: string,
  isDir: boolean,
): string | null {
  if (from === root) return "不能移动工作区根目录";
  if (normalizeAbsPath(dirname(from)) === normalizeAbsPath(toParent)) {
    return null;
  }
  if (isDir && isPathUnder(from, toParent)) {
    return "不能将文件夹移动到自身或其子目录内";
  }
  return null;
}
