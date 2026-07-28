import { invoke } from "@tauri-apps/api/core";
import { basename } from "@/shared/fs";

/** 栅格图：只能预览，不能当文本打开 */
const RASTER_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".avif",
  ".tif",
  ".tiff",
] as const;

function lowerName(path: string): string {
  return basename(path).toLowerCase();
}

export function isSvgPath(path: string): boolean {
  return lowerName(path).endsWith(".svg");
}

export function isRasterImagePath(path: string): boolean {
  const name = lowerName(path);
  return RASTER_EXTS.some((ext) => name.endsWith(ext));
}

/** 栅格图或 SVG（均可预览） */
export function isImagePath(path: string): boolean {
  return isRasterImagePath(path) || isSvgPath(path);
}

export function mimeFromPath(path: string): string {
  const name = lowerName(path);
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".bmp")) return "image/bmp";
  if (name.endsWith(".ico")) return "image/x-icon";
  if (name.endsWith(".avif")) return "image/avif";
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "image/tiff";
  if (name.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

/** 工作区内文件 → base64（后端校验路径在工作区） */
export async function readFileBase64(root: string, path: string): Promise<string> {
  return invoke<string>("read_file_base64", { root, path });
}

/** 栅格图预览 data URL */
export async function rasterDataUrl(root: string, path: string): Promise<string> {
  const base64 = await readFileBase64(root, path);
  return `data:${mimeFromPath(path)};base64,${base64}`;
}

/** 用当前文本内容生成 SVG data URL（脏文件预览） */
export function svgDataUrl(content: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}
