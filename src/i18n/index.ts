import { computed, ref } from "vue";
import type { AppSettings } from "@/shared/types";
import { enUS } from "@/i18n/locales/en-US";
import { zhCN } from "@/i18n/locales/zh-CN";

export type LocaleId = AppSettings["locale"];

type Dict = typeof zhCN;
type ParamMap = Record<string, string | number>;

const catalogs: Record<LocaleId, Dict> = {
  "zh-CN": zhCN,
  "en-US": enUS as unknown as Dict,
};

/** 与 settings.locale 同步；组件通过访问 localeRef 获得响应式 */
const localeRef = ref<LocaleId>("zh-CN");

export function setI18nLocale(locale: LocaleId) {
  localeRef.value = locale;
  document.documentElement.lang = locale === "en-US" ? "en" : "zh-CN";
}

function lookup(dict: unknown, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

function format(text: string, params?: ParamMap): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] == null ? `{${name}}` : String(params[name]),
  );
}

function translateWith(locale: LocaleId, key: string, params?: ParamMap): string {
  const primary = lookup(catalogs[locale], key);
  const fallback = lookup(catalogs["zh-CN"], key);
  return format(primary ?? fallback ?? key, params);
}

/** store / 工具函数：按当前语言取文案 */
export function t(key: string, params?: ParamMap): string {
  return translateWith(localeRef.value, key, params);
}

/** 组件内使用：模板中调用 t() 会随语言切换自动更新 */
export function useI18n() {
  function translate(key: string, params?: ParamMap): string {
    return translateWith(localeRef.value, key, params);
  }
  return {
    t: translate,
    locale: computed(() => localeRef.value),
  };
}
