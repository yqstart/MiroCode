import { joinPath, pathExists, readTextFile } from "@/shared/fs";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageScriptItem {
  name: string;
  script: string;
}

export interface PackageScriptsInfo {
  packageName: string | null;
  manager: PackageManager;
  scripts: PackageScriptItem[];
}

async function detectPackageManager(root: string): Promise<PackageManager> {
  const checks: { file: string; manager: PackageManager }[] = [
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "bun.lockb", manager: "bun" },
    { file: "bun.lock", manager: "bun" },
    { file: "package-lock.json", manager: "npm" },
  ];
  for (const item of checks) {
    try {
      if (await pathExists(root, joinPath(root, item.file))) {
        return item.manager;
      }
    } catch {
      // ignore
    }
  }
  return "npm";
}

/**
 * shell 单引号转义：键名来自项目 package.json（不可信输入），防止键名内嵌
 * `;` / `&` / `|` / `$()` / 反引号 被 shell 拆成额外命令执行（如恶意键名
 * `x; echo INJECTED` 会被拆成两条命令）。单引号内除 `'` 外一切字面；
 * 内嵌单引号按 shell 惯例 `'\''` 拼接（结束引号 → 转义引号 → 重开引号）。
 * 含空格的合法键名（如 `dev server`）转义后仍是单个参数，不受影响。
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * 安全的脚本键名无需引号：仅由字母数字及常见键名符号（: . _ @ / -）组成。
 * 命中时原样拼接（npm run dev），避免正常键名出现 `npm run 'dev'` 的多余引号；
 * 含空格/分号等 shell 特殊字符的键名仍走 shellQuote 转义（保留注入防护）。
 */
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/;

/** 生成在本地终端执行的命令（末尾不含换行） */
export function formatRunCommand(manager: PackageManager, scriptName: string): string {
  const name = SAFE_SCRIPT_NAME.test(scriptName)
    ? scriptName
    : shellQuote(scriptName);
  switch (manager) {
    case "pnpm":
      return `pnpm run ${name}`;
    case "yarn":
      return `yarn ${name}`;
    case "bun":
      return `bun run ${name}`;
    default:
      return `npm run ${name}`;
  }
}

export async function loadPackageScripts(
  root: string,
): Promise<PackageScriptsInfo | null> {
  const pkgPath = joinPath(root, "package.json");
  try {
    if (!(await pathExists(root, pkgPath))) return null;
    const raw = await readTextFile(root, pkgPath);
    const parsed = JSON.parse(raw) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const scriptsObj = parsed.scripts ?? {};
    const scripts = Object.entries(scriptsObj)
      .filter(([name, script]) => Boolean(name) && typeof script === "string")
      .map(([name, script]) => ({ name, script }));
    if (!scripts.length) {
      return {
        packageName: parsed.name ?? null,
        manager: await detectPackageManager(root),
        scripts: [],
      };
    }
    return {
      packageName: parsed.name ?? null,
      manager: await detectPackageManager(root),
      scripts,
    };
  } catch {
    return null;
  }
}
