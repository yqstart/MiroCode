import { basename } from "@/shared/fs";
import { isRasterImagePath } from "@/shared/media";

const REMOTE_PREFIX = "miro-sftp://";

export interface RemoteFileRef {
  sftpSessionId: string;
  remotePath: string;
}

/** 远程 SFTP 文件在编辑区使用的虚拟路径 */
export function buildRemoteFileUri(
  sftpSessionId: string,
  remotePath: string,
): string {
  const path = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  return `${REMOTE_PREFIX}${sftpSessionId}${path}`;
}

export function parseRemoteFileUri(path: string): RemoteFileRef | null {
  if (!path.startsWith(REMOTE_PREFIX)) return null;
  const rest = path.slice(REMOTE_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return {
    sftpSessionId: rest.slice(0, slash),
    remotePath: rest.slice(slash),
  };
}

export function isRemoteFilePath(path: string): boolean {
  return path.startsWith(REMOTE_PREFIX);
}

const BINARY_EXT = new Set([
  "zip",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "tar",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "dmg",
  "msi",
  "deb",
  "rpm",
  "apk",
]);

/** 是否适合在编辑器中打开（文本、体积可控） */
export function isEditableRemoteFile(entry: {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}): boolean {
  if (entry.isDir) return false;
  if (isRasterImagePath(entry.path)) return false;
  if (entry.size > 2 * 1024 * 1024) return false;
  const dot = entry.name.lastIndexOf(".");
  if (dot < 0) return true;
  const ext = entry.name.slice(dot + 1).toLowerCase();
  return !BINARY_EXT.has(ext);
}

export function remoteTabLabel(
  remotePath: string,
  meta: { host: string; username: string; displayName?: string },
): string {
  const name = basename(remotePath);
  const hostLabel = meta.displayName?.trim() || `${meta.username}@${meta.host}`;
  return `${name} · ${hostLabel}`;
}
