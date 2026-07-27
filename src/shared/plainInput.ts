/** 纯输入框：关闭浏览器自动补全 / 纠正 / 拼写检查等推荐行为 */
export const PLAIN_INPUT_ATTRS = {
  autocomplete: "off",
  autocorrect: "off",
  autocapitalize: "off",
  spellcheck: false,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;
