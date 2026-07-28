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

/** 生成在本地终端执行的命令（末尾不含换行） */
export function formatRunCommand(manager: PackageManager, scriptName: string): string {
  switch (manager) {
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
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
