import manifestJson from "material-icon-theme/dist/material-icons.json";
import { basename } from "@/shared/fs";

type IconManifest = {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileNames?: Record<string, string>;
  fileExtensions?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
};

const manifest = manifestJson as IconManifest;

/** Vite 将各 SVG 打成独立资源，运行时只拿 URL */
const iconModules = import.meta.glob(
  "../../node_modules/material-icon-theme/icons/*.svg",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

const iconUrlById = new Map<string, string>();
for (const [modPath, url] of Object.entries(iconModules)) {
  const id = modPath.match(/\/([^/]+)\.svg$/)?.[1];
  if (id) iconUrlById.set(id, url);
}

function urlFor(iconId: string | undefined, fallback: string): string {
  if (iconId && iconUrlById.has(iconId)) return iconUrlById.get(iconId)!;
  return iconUrlById.get(fallback) ?? "";
}

/** 按 Material Icon Theme 规则解析文件 / 文件夹图标 URL */
export function resolveMaterialIconUrl(
  path: string,
  options: { isDir?: boolean; expanded?: boolean } = {},
): string {
  const name = basename(path);
  const lower = name.toLowerCase();

  if (options.isDir) {
    if (options.expanded) {
      const id =
        manifest.folderNamesExpanded?.[lower] ??
        manifest.folderExpanded ??
        "folder-open";
      return urlFor(id, "folder-open");
    }
    const id = manifest.folderNames?.[lower] ?? manifest.folder ?? "folder";
    return urlFor(id, "folder");
  }

  // ==================== 文件：文件名 → 复合扩展名 → 扩展名 → 默认 ====================
  let iconId = manifest.fileNames?.[lower];

  if (!iconId && lower.includes(".")) {
    const parts = lower.split(".");
    for (let i = 1; i < parts.length; i++) {
      const ext = parts.slice(i).join(".");
      iconId = manifest.fileExtensions?.[ext];
      if (iconId) break;
    }
  }

  return urlFor(iconId ?? manifest.file, "file");
}
