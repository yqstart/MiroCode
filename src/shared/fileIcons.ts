import type { Component } from "vue";
import {
  Database,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType2,
  Terminal,
} from "lucide-vue-next";
import { basename } from "@/shared/fs";

export type FileIconSpec = {
  icon: Component;
  color: string;
};

/** 按扩展名 / 特殊文件名解析图标与颜色（深浅主题均可辨） */
export function resolveFileIcon(path: string): FileIconSpec {
  const name = basename(path).toLowerCase();

  // ==================== 特殊文件名 ====================
  if (
    name === "dockerfile" ||
    name.startsWith("dockerfile.") ||
    name === "containerfile"
  ) {
    return { icon: FileCog, color: "#2496ED" };
  }
  if (name === "makefile" || name === "gnumakefile" || name === "cmakelists.txt") {
    return { icon: FileCog, color: "#6D8086" };
  }
  if (
    name === "package.json" ||
    name === "package-lock.json" ||
    name === "pnpm-lock.yaml" ||
    name === "yarn.lock" ||
    name === "bun.lock" ||
    name === "bun.lockb"
  ) {
    return { icon: FileJson, color: "#CBB000" };
  }
  if (name === "cargo.toml" || name === "cargo.lock") {
    return { icon: FileCog, color: "#DEA584" };
  }
  if (name === "go.mod" || name === "go.sum") {
    return { icon: FileCode, color: "#00ADD8" };
  }
  if (name === "tsconfig.json" || name.startsWith("tsconfig.")) {
    return { icon: FileJson, color: "#3178C6" };
  }
  if (name === "readme" || name.startsWith("readme.")) {
    return { icon: FileText, color: "#42A5F5" };
  }
  if (name === "license" || name.startsWith("license.")) {
    return { icon: FileText, color: "#CBCB41" };
  }
  if (name === ".gitignore" || name === ".gitattributes" || name === ".gitmodules") {
    return { icon: FileCog, color: "#F05032" };
  }
  if (name === ".env" || name.startsWith(".env.")) {
    return { icon: FileCog, color: "#ECD53F" };
  }
  if (name === ".editorconfig") {
    return { icon: FileCog, color: "#FEFEFE" };
  }

  // ==================== 复合 / 普通扩展名 ====================
  if (name.endsWith(".d.ts")) return { icon: FileCode, color: "#3178C6" };
  if (name.endsWith(".vue")) return { icon: FileCode, color: "#41B883" };
  if (
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".mts") ||
    name.endsWith(".cts")
  ) {
    return { icon: FileCode, color: "#3178C6" };
  }
  if (
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".mjs") ||
    name.endsWith(".cjs")
  ) {
    return { icon: FileCode, color: "#D4A017" };
  }
  if (name.endsWith(".json") || name.endsWith(".jsonc") || name.endsWith(".json5")) {
    return { icon: FileJson, color: "#CBCB41" };
  }
  if (name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".mdx")) {
    return { icon: FileText, color: "#519ABA" };
  }
  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".xhtml")) {
    return { icon: FileCode, color: "#E34F26" };
  }
  if (name.endsWith(".css")) return { icon: FileCode, color: "#563D7C" };
  if (name.endsWith(".scss") || name.endsWith(".sass") || name.endsWith(".less")) {
    return { icon: FileCode, color: "#C6538C" };
  }
  if (name.endsWith(".xml") || name.endsWith(".xsl") || name.endsWith(".xslt")) {
    return { icon: FileCode, color: "#E37933" };
  }
  if (name.endsWith(".svg")) return { icon: FileImage, color: "#FFB13B" };
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return { icon: FileCog, color: "#CB171E" };
  }
  if (name.endsWith(".toml")) return { icon: FileCog, color: "#9C4221" };
  if (name.endsWith(".ini") || name.endsWith(".cfg") || name.endsWith(".conf")) {
    return { icon: FileCog, color: "#6D8086" };
  }
  if (
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".gif") ||
    name.endsWith(".webp") ||
    name.endsWith(".bmp") ||
    name.endsWith(".ico") ||
    name.endsWith(".avif") ||
    name.endsWith(".tif") ||
    name.endsWith(".tiff")
  ) {
    return { icon: FileImage, color: "#A074C4" };
  }
  if (
    name.endsWith(".mp4") ||
    name.endsWith(".webm") ||
    name.endsWith(".mov") ||
    name.endsWith(".avi") ||
    name.endsWith(".mkv")
  ) {
    return { icon: File, color: "#F43F5E" };
  }
  if (
    name.endsWith(".mp3") ||
    name.endsWith(".wav") ||
    name.endsWith(".flac") ||
    name.endsWith(".ogg") ||
    name.endsWith(".m4a")
  ) {
    return { icon: File, color: "#EC4899" };
  }
  if (
    name.endsWith(".zip") ||
    name.endsWith(".tar") ||
    name.endsWith(".gz") ||
    name.endsWith(".tgz") ||
    name.endsWith(".rar") ||
    name.endsWith(".7z") ||
    name.endsWith(".bz2")
  ) {
    return { icon: FileArchive, color: "#CA8A04" };
  }
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".xlsx")) {
    return { icon: FileSpreadsheet, color: "#89E051" };
  }
  if (
    name.endsWith(".sh") ||
    name.endsWith(".bash") ||
    name.endsWith(".zsh") ||
    name.endsWith(".fish") ||
    name.endsWith(".ps1") ||
    name.endsWith(".bat") ||
    name.endsWith(".cmd")
  ) {
    return { icon: Terminal, color: "#89E051" };
  }
  if (name.endsWith(".py") || name.endsWith(".pyw") || name.endsWith(".pyi")) {
    return { icon: FileCode, color: "#3776AB" };
  }
  if (name.endsWith(".rs")) return { icon: FileCode, color: "#DEA584" };
  if (name.endsWith(".go")) return { icon: FileCode, color: "#00ADD8" };
  if (
    name.endsWith(".java") ||
    name.endsWith(".kt") ||
    name.endsWith(".kts") ||
    name.endsWith(".scala")
  ) {
    return { icon: FileCode, color: "#B07219" };
  }
  if (name.endsWith(".c") || name.endsWith(".h")) {
    return { icon: FileCode, color: "#555555" };
  }
  if (
    name.endsWith(".cpp") ||
    name.endsWith(".cc") ||
    name.endsWith(".cxx") ||
    name.endsWith(".hpp") ||
    name.endsWith(".hh")
  ) {
    return { icon: FileCode, color: "#F34B7D" };
  }
  if (name.endsWith(".swift")) return { icon: FileCode, color: "#F05138" };
  if (name.endsWith(".rb") || name.endsWith(".erb")) {
    return { icon: FileCode, color: "#CC342D" };
  }
  if (name.endsWith(".php")) return { icon: FileCode, color: "#777BB4" };
  if (name.endsWith(".sql")) return { icon: Database, color: "#E38C10" };
  if (name.endsWith(".graphql") || name.endsWith(".gql")) {
    return { icon: FileCode, color: "#E10098" };
  }
  if (name.endsWith(".proto")) return { icon: FileCode, color: "#EDA200" };
  if (name.endsWith(".wasm")) return { icon: FileCode, color: "#654FF0" };
  if (name.endsWith(".txt") || name.endsWith(".log") || name.endsWith(".rtf")) {
    return { icon: FileText, color: "#A1A1AA" };
  }
  if (name.endsWith(".ttf") || name.endsWith(".otf") || name.endsWith(".woff") || name.endsWith(".woff2")) {
    return { icon: FileType2, color: "#EC4899" };
  }

  return { icon: File, color: "var(--text-muted)" };
}
