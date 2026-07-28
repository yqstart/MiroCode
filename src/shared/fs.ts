import { invoke } from "@tauri-apps/api/core";

export interface DirEntryInfo {
  name: string;
  path: string;
  isDir: boolean;
}

export async function listDir(
  root: string,
  path: string,
  extraIgnores: string[] = [],
): Promise<DirEntryInfo[]> {
  return invoke("list_dir", { root, path, extraIgnores });
}

export async function readTextFile(root: string, path: string): Promise<string> {
  return invoke("read_text_file", { root, path });
}

export async function writeTextFile(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  return invoke("write_text_file", { root, path, content });
}

export async function createEntry(
  root: string,
  path: string,
  isDir: boolean,
): Promise<void> {
  return invoke("create_entry", { root, path, isDir });
}

export async function renameEntry(
  root: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke("rename_entry", { root, from, to });
}

export async function deleteEntry(root: string, path: string): Promise<void> {
  return invoke("delete_entry", { root, path });
}

export async function copyEntry(
  root: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke("copy_entry", { root, from, to });
}

export async function pathExists(root: string, path: string): Promise<boolean> {
  return invoke("path_exists", { root, path });
}

export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/") || parent.endsWith("\\")) {
    return `${parent}${name}`;
  }
  const sep = parent.includes("\\") ? "\\" : "/";
  return `${parent}${sep}${name}`;
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function dirname(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  if (idx <= 0) return path;
  return path.slice(0, idx);
}

/** 相对工作区根的路径；根自身返回 `.` */
export function relativeToRoot(root: string, absPath: string): string {
  const normRoot = root.replace(/[/\\]+$/, "");
  if (absPath === normRoot) return ".";
  const prefixSlash = `${normRoot}/`;
  const prefixBack = `${normRoot}\\`;
  if (absPath.startsWith(prefixSlash)) return absPath.slice(prefixSlash.length);
  if (absPath.startsWith(prefixBack)) return absPath.slice(prefixBack.length);
  return absPath;
}

export function languageFromPath(path: string): string {
  const name = basename(path).toLowerCase();
  if (name.endsWith(".vue")) return "Vue";
  if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".mts") || name.endsWith(".cts")) {
    return "TypeScript";
  }
  if (name.endsWith(".js") || name.endsWith(".jsx") || name.endsWith(".mjs") || name.endsWith(".cjs")) {
    return "JavaScript";
  }
  if (name.endsWith(".json")) return "JSON";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "Markdown";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "HTML";
  if (name.endsWith(".css")) return "CSS";
  if (name.endsWith(".scss") || name.endsWith(".sass")) return "Sass";
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "YAML";
  if (name.endsWith(".xml")) return "XML";
  if (name === ".env" || name.startsWith(".env.")) return "Env";
  return "Plain Text";
}
