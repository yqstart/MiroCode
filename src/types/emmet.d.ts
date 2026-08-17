// emmet 包未正确暴露其 dist/index.d.ts（package.json exports 缺 types 映射），
// 此处补充最小类型声明（运行时行为与官方 API 一致）。
declare module "emmet" {
  export interface EmmetUserConfig {
    syntax?: string;
    field?: (index: number, placeholder: string) => string;
    text?: string | string[];
    variables?: Record<string, string>;
  }
  export default function expandAbbreviation(
    abbr: string,
    config?: EmmetUserConfig,
  ): string;
}
