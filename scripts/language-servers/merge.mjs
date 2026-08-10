#!/usr/bin/env node
/**
 * 汇总各平台语言服务捆绑包的 sha256，生成 ls-latest.json
 *
 * 由 .github/workflows/language-servers.yml 的汇总 job 调用。
 * 输出结构与应用端 Rust fetch_manifest 解析格式一一对应：
 * ```json
 * {
 *   "version": "0.1.0",
 *   "platforms": {
 *     "darwin-arm64": { "url": "language-servers-0.1.0-darwin-arm64.zip", "sha256": "..." },
 *     ...
 *   }
 * }
 * ```
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const PLATFORMS = ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64", "linux-arm64"];

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

const args = parseArgs(process.argv.slice(2));
const version = args.version;
const dir = resolve(REPO_ROOT, args.dir || "dist/ls");

if (!version) {
  console.error("用法: node merge.mjs --version <版本> [--dir <目录>]");
  process.exit(1);
}

const platforms = {};
for (const platform of PLATFORMS) {
  const shaFile = join(dir, `language-servers-${version}-${platform}.zip.sha256`);
  const zipFile = join(dir, `language-servers-${version}-${platform}.zip`);
  if (!readdirSync(dir).includes(`language-servers-${version}-${platform}.zip`)) {
    console.error(`缺少 ${platform} 产物，中止`);
    process.exit(1);
  }
  const sha256 = readFileSync(shaFile, "utf8").trim();
  const sizeMb = (readFileSync(zipFile).length / 1024 / 1024).toFixed(1);
  platforms[platform] = {
    url: `language-servers-${version}-${platform}.zip`,
    sha256,
    sizeMb: Number(sizeMb),
  };
}

const manifest = { version, platforms };
const out = join(dir, "ls-latest.json");
writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`[merge] 已生成 ${out}`);
console.log(JSON.stringify(manifest, null, 2));
