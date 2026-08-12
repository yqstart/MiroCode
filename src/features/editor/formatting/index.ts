// ==================== 格式化引擎入口（项目本地优先 → 内置兜底） ====================
// 开箱即用策略：项目已装 prettier（含插件、完整配置）优先走项目本地；
// 未安装 / 无法启动时回退内置 standalone（零依赖离线，覆盖前端全家桶语言）。

import { relativeToRoot } from "@/shared/fs";
import { formatWithPrettier } from "@/shared/toolingApi";
import {
  formatWithBuiltin,
  UnsupportedLanguageError,
} from "./prettierRuntime";
import { loadProjectPrettierConfig } from "./prettierConfig";

/** 格式化文件内容；失败抛中文错误（上层 showNotice 展示） */
export async function formatDocumentContent(
  root: string,
  absPath: string,
  content: string,
): Promise<string> {
  const rel = relativeToRoot(root, absPath);

  // 1. 项目本地 prettier（尊重项目依赖与完整配置）
  try {
    return await formatWithPrettier(root, rel, content);
  } catch {
    // 项目未安装 prettier / 无法启动 → 回退内置
  }

  // 2. 内置 standalone（零依赖、离线、任意项目可用）
  try {
    const config = await loadProjectPrettierConfig(root);
    return await formatWithBuiltin(absPath, content, config ?? undefined);
  } catch (error) {
    if (error instanceof UnsupportedLanguageError) throw error;
    const detail =
      error instanceof Error && error.message ? `：${error.message}` : "";
    throw new Error(`格式化失败${detail}`);
  }
}
