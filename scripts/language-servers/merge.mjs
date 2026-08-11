#!/usr/bin/env node
/**
 * 汇总各平台 × 各语言的 sha256，生成双层 ls-latest.json
 *
 * 由 .github/workflows/language-servers.yml 的汇总 job 调用。
 * 输出结构与应用端 Rust fetch_manifest 解析格式一一对应：
 * ```json
 * {
 *   "version": "0.2.0",
 *   "languages": {
 *     "ts": {
 *       "version": "0.2.0",
 *       "platforms": {
 *         "darwin-arm64": { "url": "ls-ts-0.2.0-darwin-arm64.zip", "sha256": "..." },
 *         ...
 *       }
 *     },
 *     "vue": {
 *       "version": "0.2.0",
 *       "platforms": { ... }
 *     }
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
const LANGUAGES = ["ts", "vue"];

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

const languages = {};
for (const language of LANGUAGES) {
  const platforms = {};
  for (const platform of PLATFORMS) {
    const zipName = `ls-${language}-${version}-${platform}.zip`;
    const shaFile = join(dir, `${zipName}.sha256`);
    const zipFile = join(dir, zipName);
    if (!readdirSync(dir).includes(zipName)) {
      console.error(`缺少 ${language} ${platform} 产物（${zipName}），中止`);
      process.exit(1);
    }
    const sha256 = readFileSync(shaFile, "utf8").trim();
    const sizeMb = (readFileSync(zipFile).length / 1024 / 1024).toFixed(1);
    platforms[platform] = { url: zipName, sha256, sizeMb: Number(sizeMb) };
  }
  languages[language] = { version, platforms };
}

const manifest = { version, languages };
const out = join(dir, "ls-latest.json");
writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`[merge] 已生成 ${out}`);
console.log(JSON.stringify(manifest, null, 2));
