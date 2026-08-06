import { basename, relativeToRoot } from "@/shared/fs";

/**
 * 为编辑器标签生成展示名：basename 唯一时仅显示文件名；
 * 存在同名文件时追加父路径直至可区分（如 `components/index.vue`）。
 */
export function disambiguateTabLabels(
  paths: string[],
  rootPath: string | null,
): Map<string, string> {
  const result = new Map<string, string>();
  const byBase = new Map<string, string[]>();

  for (const path of paths) {
    const base = basename(path);
    const list = byBase.get(base) ?? [];
    list.push(path);
    byBase.set(base, list);
  }

  for (const [base, group] of byBase) {
    if (group.length === 1) {
      result.set(group[0], base);
      continue;
    }

    const entries = group.map((path) => {
      const rel = rootPath ? relativeToRoot(rootPath, path) : path;
      const parts = rel.split(/[/\\]/).filter(Boolean);
      return { path, parts };
    });

    const maxDepth = Math.max(...entries.map((e) => e.parts.length));
    let resolved = false;

    for (let depth = 2; depth <= maxDepth; depth += 1) {
      const labels = entries.map((e) =>
        e.parts.slice(-Math.min(depth, e.parts.length)).join("/"),
      );
      if (new Set(labels).size === labels.length) {
        entries.forEach((e, i) => result.set(e.path, labels[i]));
        resolved = true;
        break;
      }
    }

    if (!resolved) {
      for (const e of entries) {
        result.set(e.path, e.parts.join("/"));
      }
    }
  }

  return result;
}

/** 标签 hover 提示：工作区相对路径 */
export function tabTooltip(path: string, rootPath: string | null): string {
  if (!rootPath) return path;
  const rel = relativeToRoot(rootPath, path);
  return rel === "." ? basename(path) : rel;
}
