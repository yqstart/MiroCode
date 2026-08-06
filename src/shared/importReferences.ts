import {
  dirname,
  joinPath,
  listDir,
  pathExists,
  readTextFile,
  relativePath,
  writeTextFile,
  normalizeAbsPath,
  isPathUnder,
  type DirEntryInfo,
} from "@/shared/fs";

export const IMPORT_RE =
  /(?:import\s+(?:[\w*{}\s,]+\s+from\s+|)|require\s*\(\s*|from\s+)['"]([^'"]+)['"]/g;

export const PATH_RE = /['"](\.{1,2}\/[^'"]+)['"]/g;

const RESOLVE_EXTENSIONS = [
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

/** 同步解析（跳转用，不查磁盘） */
export function resolveImportCandidate(
  workspaceRoot: string | null,
  currentFile: string,
  spec: string,
): string | null {
  if (!workspaceRoot || !spec.startsWith(".")) return null;
  const base = dirname(currentFile);
  const target = joinPath(base, spec);

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = ext.startsWith("/") ? `${target}${ext}` : `${target}${ext}`;
    if (candidate.startsWith(workspaceRoot)) return candidate;
  }
  if (target.startsWith(workspaceRoot)) return target;
  return null;
}

/** 解析相对 import 为工作区内绝对路径（需磁盘存在） */
export async function resolveImportPath(
  root: string,
  currentFile: string,
  spec: string,
): Promise<string | null> {
  if (!spec.startsWith(".")) return null;
  const base = dirname(currentFile);
  const target = joinPath(base, spec);

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = ext.startsWith("/") ? `${target}${ext}` : `${target}${ext}`;
    if (!(await pathExists(root, candidate))) continue;
    return candidate;
  }
  return null;
}

function stripKnownExtensions(path: string): string {
  for (const ext of [".tsx", ".ts", ".jsx", ".js", ".vue", ".json"]) {
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
        if (!spec.startsWith(".")) continue;
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
