import { invoke } from "@tauri-apps/api/core";

export interface EslintDiag {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: string;
  message: string;
}

/** 用项目 Prettier 格式化；失败抛错 */
export async function formatWithPrettier(
  root: string,
  relPath: string,
  content: string,
): Promise<string> {
  return invoke("format_with_prettier", { root, relPath, content });
}

/** 对工作区相对路径跑 ESLint */
export async function lintWithEslint(
  root: string,
  relPath: string,
): Promise<EslintDiag[]> {
  return invoke("lint_with_eslint", { root, relPath });
}
