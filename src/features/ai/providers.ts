/**
 * AI 补全 provider 预设
 *
 * 仅内置 DeepSeek 与自定义两个 provider。选择预设后自动填充 apiBase/model，
 * 仍可手动覆盖。
 */

import type { AiProviderId } from "@/shared/types";

export interface ProviderPreset {
  /** provider id */
  id: AiProviderId;
  /** 显示名 */
  label: string;
  /** 默认 API 基地址 */
  apiBase: string;
  /** 默认模型名 */
  model: string;
  /** 对应 COMPLETION_TEMPLATES 的 key（DeepSeek 走标准 /completions prompt+suffix） */
  fimTemplate: string;
}

/** 内置 provider 预设列表 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    apiBase: "https://api.deepseek.com/beta",
    model: "deepseek-v4-pro",
    fimTemplate: "standard",
  },
  {
    id: "custom",
    label: "自定义",
    apiBase: "",
    model: "",
    fimTemplate: "standard",
  },
];

/** 按 id 查找预设 */
export function getPreset(id: AiProviderId): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
