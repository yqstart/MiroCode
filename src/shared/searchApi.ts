import { invoke } from "@tauri-apps/api/core";

export interface FileSearchHit {
  path: string;
  name: string;
  relative: string;
  score: number;
}

export interface ContentHit {
  path: string;
  relative: string;
  line: number;
  column: number;
  preview: string;
}

export interface ReplaceResult {
  changedFiles: number;
  replacements: number;
  files: string[];
  /** 因超过 2MB 上限被跳过的文件数（后端护栏，UI 应提示） */
  skippedLargeFiles: number;
}

export interface SearchOptions {
  maxResults?: number;
  extensions?: string[];
  extraIgnores?: string[];
}

export interface ContentSearchOptions extends SearchOptions {
  caseSensitive?: boolean;
  contextLines?: number;
}

export interface ReplaceOptions extends ContentSearchOptions {
  paths?: string[];
  dryRun?: boolean;
}

export async function searchFiles(
  root: string,
  query: string,
  options: SearchOptions = {},
): Promise<FileSearchHit[]> {
  return invoke("search_files", { root, query, ...options });
}

export async function searchContent(
  root: string,
  query: string,
  options: ContentSearchOptions = {},
): Promise<ContentHit[]> {
  return invoke("search_content", { root, query, ...options });
}

export async function replaceInFiles(
  root: string,
  query: string,
  replacement: string,
  options: ReplaceOptions = {},
): Promise<ReplaceResult> {
  return invoke("replace_in_files", { root, query, replacement, ...options });
}
