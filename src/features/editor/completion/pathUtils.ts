// ==================== import 路径工具（纯函数） ====================
// 零 @/ 依赖，便于 node --experimental-strip-types 直测。

/** 计算 fromFile 到 toFile 的相对 import spec（`./` 开头，VS Code 默认风格） */
export function relativeImportSpec(fromFile: string, toFile: string): string {
  const fromDir = fromFile.slice(0, fromFile.lastIndexOf("/"));
  const toDir = toFile.slice(0, toFile.lastIndexOf("/"));
  const fromParts = fromDir.split("/");
  const toParts = toDir.split("/");
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i += 1;
  const ups = fromParts.length - i;
  const downs = toParts.slice(i);
  const rel = [...Array(ups).fill(".."), ...downs, basename(toFile)].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** 取路径的文件名部分（POSIX 语义，零依赖） */
export function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * node_modules 裸包路径解析（纯函数）：
 * - 'reac'        → 列 node_modules 顶层包
 * - '@vue/'       → 列 @vue 下包
 * - 'lodash/'     → 列 lodash 包内（exports/main 简化：直接列目录）
 * - 'lodash/merge'→ 列 lodash/merge 下
 * 返回（目录, 前缀）；无法解析返回 null。
 */
export function nodeModulesPath(
  root: string,
  spec: string,
): { dirPath: string; prefix: string } | null {
  const nm = `${root}/node_modules`;
  if (spec.startsWith("@")) {
    // 保留尾空段：`@vue/` 与 `@vue` 语义不同（前者列 scope 下包）
    const parts = spec.split("/");
    if (parts.length === 0 || (parts.length === 1 && !parts[0])) {
      return { dirPath: nm, prefix: "@" };
    }
    if (parts.length === 1) return { dirPath: nm, prefix: parts[0] }; // @scope 列顶层
    if (parts.length === 2) {
      return { dirPath: `${nm}/${parts[0]}`, prefix: parts[1] }; // @scope/ 下列包
    }
    return {
      dirPath: `${nm}/${parts[0]}/${parts[1]}`,
      prefix: parts.slice(2).join("/"),
    };
  }
  const slash = spec.lastIndexOf("/");
  if (slash < 0) return { dirPath: nm, prefix: spec };
  return {
    dirPath: `${nm}/${spec.slice(0, slash)}`,
    prefix: spec.slice(slash + 1),
  };
}
