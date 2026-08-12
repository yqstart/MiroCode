// ==================== 内置 Prettier 引擎（standalone，零依赖离线） ====================
// 按扩展名动态加载对应 parser 插件（vite 分包，仅首次格式化时加载）；
// 覆盖 prettier 官方 standalone 全量语言：JS/TS/JSON/CSS/SCSS/Less/HTML/Vue/MD/YAML/GraphQL。
// 项目本地 prettier 不可用时兜底，保证任意项目开箱即用。

import type { Options, Plugin } from "prettier";

/** 内置格式化不支持的扩展名 → 抛此错误（上层提示「暂不支持」） */
export class UnsupportedLanguageError extends Error {}

/** 各插件动态加载器：显式字面量，保证 vite 精确分包 */
const LOADERS = {
  babel: () => import("prettier/plugins/babel"),
  estree: () => import("prettier/plugins/estree"),
  typescript: () => import("prettier/plugins/typescript"),
  postcss: () => import("prettier/plugins/postcss"),
  html: () => import("prettier/plugins/html"),
  markdown: () => import("prettier/plugins/markdown"),
  yaml: () => import("prettier/plugins/yaml"),
  graphql: () => import("prettier/plugins/graphql"),
} as const;

type LoaderKey = keyof typeof LOADERS;

interface BuiltinRule {
  parser: string;
  plugins: LoaderKey[];
}

/** 扩展名 → parser 与插件组（与 prettier 3.x standalone 实测一致） */
const EXT_RULES: Record<string, BuiltinRule> = {
  js: { parser: "babel", plugins: ["babel", "estree"] },
  jsx: { parser: "babel", plugins: ["babel", "estree"] },
  mjs: { parser: "babel", plugins: ["babel", "estree"] },
  cjs: { parser: "babel", plugins: ["babel", "estree"] },
  ts: { parser: "typescript", plugins: ["typescript", "estree"] },
  tsx: { parser: "typescript", plugins: ["typescript", "estree"] },
  mts: { parser: "typescript", plugins: ["typescript", "estree"] },
  cts: { parser: "typescript", plugins: ["typescript", "estree"] },
  json: { parser: "json", plugins: ["babel", "estree"] },
  jsonc: { parser: "jsonc", plugins: ["babel", "estree"] },
  json5: { parser: "json5", plugins: ["babel", "estree"] },
  css: { parser: "css", plugins: ["postcss"] },
  scss: { parser: "scss", plugins: ["postcss"] },
  less: { parser: "less", plugins: ["postcss"] },
  html: { parser: "html", plugins: ["html"] },
  htm: { parser: "html", plugins: ["html"] },
  // vue 内 <script lang="ts"> 需 typescript + estree 处理
  vue: { parser: "vue", plugins: ["html", "typescript", "estree"] },
  md: { parser: "markdown", plugins: ["markdown"] },
  markdown: { parser: "markdown", plugins: ["markdown"] },
  yaml: { parser: "yaml", plugins: ["yaml"] },
  yml: { parser: "yaml", plugins: ["yaml"] },
  gql: { parser: "graphql", plugins: ["graphql"] },
  graphql: { parser: "graphql", plugins: ["graphql"] },
};

/** 内置引擎是否支持该路径（供提前判断「暂不支持」） */
export function isBuiltinSupported(filepath: string): boolean {
  return extOf(filepath) in EXT_RULES;
}

function extOf(filepath: string): string {
  const name = filepath.toLowerCase();
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1) : "";
}

export type BuiltinPrettierConfig = Partial<Omit<Options, "parser" | "plugins">>;

/** 用内置 prettier 格式化；扩展名不支持时抛 UnsupportedLanguageError */
export async function formatWithBuiltin(
  filepath: string,
  content: string,
  config: BuiltinPrettierConfig = {},
): Promise<string> {
  const rule = EXT_RULES[extOf(filepath)];
  if (!rule) {
    throw new UnsupportedLanguageError("暂不支持格式化该语言");
  }
  const [{ format }, ...pluginMods] = await Promise.all([
    import("prettier/standalone"),
    ...rule.plugins.map((name) => LOADERS[name]()),
  ]);
  const plugins = pluginMods.map((m) => (m.default ?? m) as Plugin);
  return format(content, { parser: rule.parser, plugins, ...config });
}
