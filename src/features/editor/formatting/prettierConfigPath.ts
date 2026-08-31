/**
 * Prettier 配置按当前文件目录向工作区根逐级查找。
 * 返回值是相对工作区根的目录，最近目录优先；工作区外文件只回退根目录。
 */
export function prettierConfigSearchDirs(root: string, absPath: string): string[] {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRoot = normalize(root);
  const normalizedPath = normalize(absPath);
  const slash = normalizedPath.lastIndexOf("/");
  const fileDir = slash > 0 ? normalizedPath.slice(0, slash) : normalizedPath;
  const comparableRoot = normalizedRoot.toLowerCase();
  const comparableDir = fileDir.toLowerCase();

  if (
    comparableDir !== comparableRoot &&
    !comparableDir.startsWith(`${comparableRoot}/`)
  ) {
    return ["."];
  }

  const relative = fileDir.slice(normalizedRoot.length).replace(/^\/+/, "");
  if (!relative) return ["."];

  const parts = relative.split("/").filter(Boolean);
  const directories: string[] = [];
  for (let length = parts.length; length > 0; length -= 1) {
    directories.push(parts.slice(0, length).join("/"));
  }
  directories.push(".");
  return directories;
}
