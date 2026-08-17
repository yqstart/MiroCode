import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { basename } from "@/shared/fs";

const envLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match(/#.*/)) return "comment";
    if (stream.match(/"(?:\\.|[^"\\])*"/)) return "string";
    if (stream.match(/'(?:\\.|[^'\\])*'/)) return "string";
    if (stream.match(/[^=#\s]+(?==)/)) return "def";
    if (stream.match(/=/)) return "operator";
    stream.next();
    return null;
  },
});

/**
 * Vue SFC：不用 `@codemirror/lang-vue`（其 wrap 会覆盖 html 对 `<style>`/`<script>` 的嵌套）。
 * 以 html 为基础，并为 `lang=scss|sass|less` 注册嵌套语言（默认仅识别空 lang / css）。
 * 三个解析包并行动态加载后组装。
 */
async function vueLanguageSupport(): Promise<Extension> {
  const [{ html }, { sass, sassLanguage }, { less, lessLanguage }] = await Promise.all([
    import("@codemirror/lang-html"),
    import("@codemirror/lang-sass"),
    import("@codemirror/lang-less"),
  ]);
  /** 缩进式 Sass（`lang="sass"`）解析器 */
  const indentedSassParser = sass({ indented: true }).language.parser;
  return [
    html({
      selfClosingTags: true,
      nestedLanguages: [
        {
          tag: "style",
          attrs: (attrs) => /^scss$/i.test(attrs.lang || ""),
          parser: sassLanguage.parser,
        },
        {
          tag: "style",
          attrs: (attrs) => /^sass$/i.test(attrs.lang || ""),
          parser: indentedSassParser,
        },
        {
          tag: "style",
          attrs: (attrs) => /^less$/i.test(attrs.lang || ""),
          parser: lessLanguage.parser,
        },
      ],
    }),
    sass().support,
    sass({ indented: true }).support,
    less().support,
  ];
}

/**
 * 按扩展名返回语言解析器；解析包均动态 import（vite 拆独立 chunk），打开对应类型文件时才加载。
 * 调用方在视图创建后异步 reconfigure 装配；返回 null 表示无专属解析器（按 plain text 渲染）。
 */
export async function languageExtensionForPath(path: string): Promise<Extension | null> {
  const name = basename(path).toLowerCase();
  if (name.endsWith(".vue")) {
    return vueLanguageSupport();
  }
  if (
    name.endsWith(".ts") ||
    name.endsWith(".tsx") ||
    name.endsWith(".mts") ||
    name.endsWith(".cts")
  ) {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ typescript: true, jsx: name.endsWith("x") });
  }
  if (
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".mjs") ||
    name.endsWith(".cjs")
  ) {
    const { javascript } = await import("@codemirror/lang-javascript");
    return javascript({ jsx: name.endsWith("x") });
  }
  if (name.endsWith(".json")) {
    const { json } = await import("@codemirror/lang-json");
    return json();
  }
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    const { markdown } = await import("@codemirror/lang-markdown");
    return markdown();
  }
  if (name.endsWith(".html") || name.endsWith(".htm")) {
    const { html } = await import("@codemirror/lang-html");
    return html({ selfClosingTags: true });
  }
  if (name.endsWith(".scss")) {
    const { sass } = await import("@codemirror/lang-sass");
    return sass();
  }
  if (name.endsWith(".sass")) {
    const { sass } = await import("@codemirror/lang-sass");
    return sass({ indented: true });
  }
  if (name.endsWith(".less")) {
    const { less } = await import("@codemirror/lang-less");
    return less();
  }
  if (name.endsWith(".css")) {
    const { css } = await import("@codemirror/lang-css");
    return css();
  }
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    const { yaml } = await import("@codemirror/lang-yaml");
    return yaml();
  }
  if (name.endsWith(".xml") || name.endsWith(".svg")) {
    const { xml } = await import("@codemirror/lang-xml");
    return xml();
  }
  if (name === ".env" || name.startsWith(".env.")) return envLanguage;
  return null;
}