import { invoke } from "@tauri-apps/api/core";

/** 用项目 Prettier 格式化；失败抛错 */
export async function formatWithPrettier(
  root: string,
  relPath: string,
  content: string,
): Promise<string> {
  return invoke("format_with_prettier", { root, relPath, content });
}
