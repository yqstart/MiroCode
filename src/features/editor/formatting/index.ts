// ==================== 格式化引擎入口（项目本地优先 → 内置兜底） ====================
// 开箱即用策略：项目已装 prettier（含插件、完整配置）优先走项目本地；
// 未安装 / 无法启动时回退内置 standalone（零依赖离线，覆盖前端全家桶语言）。

import { relativeToRoot } from "@/shared/fs";
import {
  formatWithPrettier,
  type PrettierFormatOptions,
} from "@/shared/toolingApi";
import {
  formatWithBuiltin,
  UnsupportedLanguageError,
} from "./prettierRuntime";
import { loadProjectPrettierConfig } from "./prettierConfig";
import { formatBuiltinRangeFallback } from "./rangeFallback";
import { singleTextChange, type TextChangeRange } from "./textChange";

function asTextChangeRange(
  options: PrettierFormatOptions,
): TextChangeRange | null {
  if (
    typeof options.rangeStart !== "number" ||
    typeof options.rangeEnd !== "number" ||
    options.rangeStart < 0 ||
    options.rangeEnd <= options.rangeStart
  ) {
    return null;
  }
  return { from: options.rangeStart, to: options.rangeEnd };
}

/** range 格式化可能会在文件末尾去掉换行；恢复原始边界，便于 CM 做安全 diff。 */
function preserveRangeEndOfLine(
  before: string,
  after: string,
  range: TextChangeRange | null,
): string {
  if (!range || before.length === 0 || after.length === 0) return after;
  const eol = before.match(/(?:\r\n|\n|\r)$/)?.[0];
  return eol && !after.endsWith(eol) ? `${after}${eol}` : after;
}

/** 格式化文件内容；失败抛中文错误（上层 showNotice 展示） */
export async function formatDocumentContent(
  root: string,
  absPath: string,
  content: string,
  options: PrettierFormatOptions = {},
): Promise<string> {
  const rel = relativeToRoot(root, absPath);
  const range = asTextChangeRange(options);

  // 1. 项目本地 prettier（尊重项目依赖与完整配置）
  let projectError = "";
  try {
    const formatted = await formatWithPrettier(root, rel, content, options);
    const normalized = preserveRangeEndOfLine(content, formatted, range);
    if (!range || (normalized !== content && singleTextChange(content, normalized, range))) {
      return normalized;
    }
  } catch (error) {
    projectError = error instanceof Error ? error.message : String(error);
  }

  // 2. 内置 standalone（零依赖、离线、任意项目可用）
  try {
    const config = await loadProjectPrettierConfig(root, absPath);
    const formatted = await formatWithBuiltin(absPath, content, {
      ...(config ?? {}),
      ...options,
    });
    const normalized = preserveRangeEndOfLine(content, formatted, range);
    if (!range || (normalized !== content && singleTextChange(content, normalized, range))) {
      return normalized;
    }
    return range
      ? await formatBuiltinRangeFallback(absPath, content, range, config ?? {})
      : normalized;
  } catch (error) {
    if (error instanceof UnsupportedLanguageError) throw error;
    const detail =
      error instanceof Error && error.message ? error.message : String(error);
    const projectDetail = projectError ? `；项目 Prettier：${projectError}` : "";
    throw new Error(`格式化失败：${detail}${projectDetail}`);
  }
}
