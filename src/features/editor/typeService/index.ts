// ==================== 类型服务浏览器入口（单例 + 惰性加载） ====================
// typescript 包 ~8MB 动态 import（vite 拆独立 chunk），首次 JS/TS 补全才加载；
// 加载完成前补全源返回 null → 分派链降级轻量语义层。

import { TsLanguageService, type FileContentSource, type TsModule } from "./tsService";

let tsPromise: Promise<TsModule> | null = null;

/** 惰性加载 typescript（失败可重试） */
export function loadTypeScript(): Promise<TsModule> {
  tsPromise ??= import("typescript");
  tsPromise.catch(() => {
    tsPromise = null;
  });
  return tsPromise;
}

/** 已打开文件内容（editor store；Pinia 未激活/无 tab 返回 undefined） */
export async function openedContent(path: string): Promise<string | undefined> {
  try {
    const { useEditorStore } = await import("@/stores/editor");
    const tab = useEditorStore().tabs.find((t) => t.path === path);
    return tab?.content;
  } catch {
    return undefined;
  }
}

/** 磁盘读取（workspace root + readTextFile） */
export async function readDiskContent(path: string): Promise<string | null> {
  try {
    const { useWorkspaceStore } = await import("@/stores/workspace");
    const root = useWorkspaceStore().rootPath;
    if (!root) return null;
    const { readTextFile } = await import("@/shared/fs");
    return await readTextFile(root, path);
  } catch {
    return null;
  }
}

/** 浏览器文件源（openedContent 异步获取：ensureFile 时先查已打开 tab） */
const dynamicSource: FileContentSource = {
  openedContent() {
    return undefined;
  },
  readDisk: readDiskContent,
};

/** 类型服务单例 */
export const tsService = new TsLanguageService();

/** 确保类型服务就绪（返回 true 表示可继续查询） */
export async function ensureTypeService(root: string): Promise<boolean> {
  if (tsService.ready) return true;
  try {
    const [tsMod, { LIB_FILES }] = await Promise.all([
      loadTypeScript(),
      import("./libFiles"),
    ]);
    tsService.init(tsMod, root, dynamicSource, LIB_FILES);
    return true;
  } catch {
    return false;
  }
}

/**
 * 同步已打开文件到类型服务程序（编辑器创建/内容变化时调用）。
 * 返回 true 表示文件已注册到程序。
 */
export function syncOpenedFile(path: string, content: string): boolean {
  if (!tsService.ready) return false;
  tsService.setFile(path, content);
  return true;
}
