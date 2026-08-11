#!/usr/bin/env node
/**
 * 语言服务捆绑包打包脚本（单个平台 × 单个语言）
 *
 * 产物：ls-<language>-<version>-<platform>.zip，内含：
 * ```text
 * zip/
 *   manifest.json        # { language, version, nodeVersion, platform, entry }
 *   node/                # 便携 Node 运行时（解压自 nodejs.org 官方包）
 *   node_modules/        # 该语言对应的 language server 包
 * ```
 *
 * 用法：
 *   node scripts/language-servers/build.mjs --language ts --platform darwin-arm64 --version 0.2.0 [--node-version 22.14.0] [--out dist/ls]
 *
 * 由 .github/workflows/language-servers.yml 在 5 平台 × N 语言矩阵上并发执行，
 * 汇总 job 收集各产物 sha256 生成 ls-latest.json 并发布到 GitHub Release。
 *
 * 关键设计：
 * - server 入口通过读 node_modules 内包 package.json 的 bin 字段解析真实 JS 路径，
 *   Rust 侧用捆绑的 node 直接执行该 JS（Windows 上绕开 .cmd shim，跨平台一致）
 * - 只做"下载 + 组装"，不重新构建任何包 -- 产物就是官方 npm 包的原样拷贝
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// ==================== 参数解析 ====================

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? next : true;
      if (next && !next.startsWith("--")) i++;
    }
  }
  return args;
}

// ==================== 语言定义 ====================

/**
 * 支持的语言服务定义。
 * 每语言独立打包，npmPackages 为该语言 zip 内 node_modules 需安装的包。
 *
 * 注意：typescript 锁定 ^5.x -- TS 7（原生 Go 移植版）无 lib/tsserver.js，
 * typescript-language-server 的 bundledVersion 依赖该结构。
 */
const LANGUAGES = {
  ts: {
    npmPackages: ["typescript@^5.9", "typescript-language-server"],
    /** 从哪个包的 package.json bin 字段解析 server 入口 */
    entryPackage: "typescript-language-server",
  },
  vue: {
    npmPackages: ["@vue/language-server"],
    entryPackage: "@vue/language-server",
  },
};

// ==================== 平台映射 ====================

/** 平台标识 -> nodejs.org 官方包信息 */
const NODE_PACKAGES = {
  "darwin-arm64": { file: (v) => `node-v${v}-darwin-arm64.tar.gz`, archive: "tar" },
  "darwin-x64": { file: (v) => `node-v${v}-darwin-x64.tar.gz`, archive: "tar" },
  "linux-x64": { file: (v) => `node-v${v}-linux-x64.tar.gz`, archive: "tar" },
  "linux-arm64": { file: (v) => `node-v${v}-linux-arm64.tar.gz`, archive: "tar" },
  "win32-x64": { file: (v) => `node-v${v}-win-x64.zip`, archive: "zip" },
};

const NODE_MIRRORS = [
  (v, f) => `https://nodejs.org/dist/v${v}/${f}`,
  (v, f) => `https://npmmirror.com/mirrors/node/v${v}/${f}`,
];

// ==================== 工具函数 ====================

function run(cmd, args, opts = {}) {
  console.log(`[build] 执行: ${cmd} ${args.join(" ")}`);
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd)) {
    // Windows 上 Node 的 execFileSync 不能直接执行 .cmd/.bat 批处理（EINVAL），
    // 需经 cmd /c 包装后由 cmd.exe 解析执行（npm.cmd 等）
    return execFileSync("cmd", ["/C", cmd, ...args], { stdio: "inherit", ...opts });
  }
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

/** 下载文件（主源失败自动切镜像源） */
function download(urls, dest) {
  for (const url of urls) {
    console.log(`[build] 下载: ${url}`);
    try {
      execFileSync(
        process.platform === "win32" ? "curl.exe" : "curl",
        ["-fSL", "--retry", "3", "-o", dest, url],
        { stdio: "inherit" },
      );
      return;
    } catch {
      console.warn(`[build] 下载失败，切换下一个镜像源: ${url}`);
    }
  }
  throw new Error(`下载失败: ${urls[0]}`);
}

function sha256Hex(file) {
  const data = readFileSync(file);
  return createHash("sha256").update(data).digest("hex");
}

// ==================== 主流程 ====================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const language = args.language;
  const platform = args.platform;
  const version = args.version;
  const nodeVersion = args["node-version"] || "22.14.0";
  const outDir = resolve(REPO_ROOT, args.out || "dist/ls");

  if (!language || !platform || !version) {
    console.error("用法: node build.mjs --language <ts|vue> --platform <平台> --version <版本> [--node-version <版本>] [--out <目录>]");
    process.exit(1);
  }
  if (!LANGUAGES[language]) {
    console.error(`不支持的语言: ${language}（可选: ${Object.keys(LANGUAGES).join(", ")}）`);
    process.exit(1);
  }
  if (!NODE_PACKAGES[platform]) {
    console.error(`不支持的平台: ${platform}（可选: ${Object.keys(NODE_PACKAGES).join(", ")}）`);
    process.exit(1);
  }

  const langDef = LANGUAGES[language];
  const pkg = NODE_PACKAGES[platform];
  const staging = join(outDir, `.staging-${language}`);
  const cache = join(outDir, ".cache");
  mkdirSync(staging, { recursive: true });
  mkdirSync(cache, { recursive: true });

  // 1. 下载便携 Node 运行时
  const nodeFile = pkg.file(nodeVersion);
  const nodeArchive = join(cache, nodeFile);
  if (!existsSync(nodeArchive)) {
    download(
      NODE_MIRRORS.map((m) => m(nodeVersion, nodeFile)),
      nodeArchive,
    );
  }

  // 2. 解压 Node 到 staging/node（自动剥离顶层目录 node-vX.Y.Z-*）
  const nodeDir = join(staging, "node");
  rmSync(nodeDir, { recursive: true, force: true });
  mkdirSync(nodeDir, { recursive: true });
  if (pkg.archive === "tar") {
    run("tar", ["-xzf", nodeArchive, "--strip-components=1", "-C", nodeDir]);
  } else {
    // Windows：Git Bash 的 GNU tar 不支持 zip 格式，改用 PowerShell Expand-Archive。
    // node zip 顶层是 node-vX.Y.Z-win-x64/，解压后剥离顶层目录再移动到 nodeDir。
    const winExtract = join(staging, ".node-win-extract");
    rmSync(winExtract, { recursive: true, force: true });
    mkdirSync(winExtract, { recursive: true });
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${nodeArchive}' -DestinationPath '${winExtract}' -Force`,
    ]);
    const topDir = readdirSync(winExtract).find(
      (f) => existsSync(join(winExtract, f, "node.exe")),
    );
    if (!topDir) throw new Error("Node zip 结构异常，未找到 node.exe 所在顶层目录");
    // 用 Node fs 拷贝（跨平台无 shell 转义问题），剥离顶层目录
    cpSync(join(winExtract, topDir), nodeDir, { recursive: true });
    rmSync(winExtract, { recursive: true, force: true });
  }

  // 3. 安装该语言的 language server 包到 staging/node_modules
  //    使用捆绑的 node 执行 npm（与最终运行时同版本）
  const npmBin = process.platform === "win32"
    ? join(nodeDir, "npm.cmd")
    : join(nodeDir, "bin", "npm");
  run(npmBin, [
    "install",
    "--prefix", staging,
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    ...langDef.npmPackages,
  ]);

  // 4. 解析 server 真实 JS 入口（读包 package.json bin 字段）
  //    bin 规则与 npm npx 一致：优先短名 key（scoped 包剥前缀），否则取第一个值
  const pkgName = langDef.entryPackage;
  const pkgJsonPath = join(staging, "node_modules", pkgName, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const bin =
    typeof pkgJson.bin === "string"
      ? pkgJson.bin
      : pkgJson.bin?.[pkgName.split("/").pop()] ?? Object.values(pkgJson.bin ?? {})[0];
  if (!bin) throw new Error(`${pkgName} 缺少 bin 入口`);
  // 统一为正斜杠相对路径（剥掉可能的 ./ 前缀），Rust 侧 join 兼容
  const entry = `node_modules/${pkgName}/${bin.replaceAll("\\", "/").replace(/^\.\//, "")}`;
  console.log(`[build] ${language} -> ${entry}`);

  // 5. 写 manifest.json（单语言单入口格式，供应用端 bundled_runtime 解析）
  writeFileSync(
    join(staging, "manifest.json"),
    JSON.stringify(
      {
        language,
        version,
        nodeVersion,
        platform,
        entry,
      },
      null,
      2,
    ),
  );

  // 6. 打 zip（zip 根即 bundle 根，解压后直接构成版本目录）
  const zipName = `ls-${language}-${version}-${platform}.zip`;
  const zipPath = join(outDir, zipName);
  rmSync(zipPath, { force: true });
  if (process.platform === "win32") {
    // Windows：npm install 后 node.exe 句柄可能未及时释放，Compress-Archive 读文件
    // 偶发 PermissionDenied；带重试 + 等待，最多试 5 次
    const psScript =
      `$dest = '${zipPath}'\n` +
      `$src = '${join(staging, "*")}'\n` +
      `for ($i = 0; $i -lt 5; $i++) {\n` +
      `  try { Compress-Archive -Path $src -DestinationPath $dest -Force; break }\n` +
      `  catch { Start-Sleep -Seconds 2 }\n` +
      `}\n` +
      `if (-not (Test-Path $dest)) { throw '打 zip 失败：node 进程文件占用未释放' }\n`;
    run("powershell", ["-NoProfile", "-Command", psScript]);
  } else {
    run("zip", ["-qr", zipPath, "."], { cwd: staging });
  }

  // 7. 输出 sha256（供汇总 job 生成 ls-latest.json）
  const sha = sha256Hex(zipPath);
  writeFileSync(join(outDir, `${zipName}.sha256`), sha);
  console.log(`[build] 产物: ${zipPath}`);
  console.log(`[build] sha256: ${sha}`);
  console.log(`[build] 大小: ${(readFileSync(zipPath).length / 1024 / 1024).toFixed(1)} MB`);

  // 清理暂存目录
  rmSync(staging, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("[build] 打包失败:", err);
  process.exit(1);
});
