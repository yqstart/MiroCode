import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { less, lessLanguage } from "@codemirror/lang-less";
import { markdown } from "@codemirror/lang-markdown";
import { sass, sassLanguage } from "@codemirror/lang-sass";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
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

/** 缩进式 Sass（`lang="sass"`）解析器 */
const indentedSassParser = sass({ indented: true }).language.parser;

/**
 * Vue SFC：不用 `@codemirror/lang-vue`（其 wrap 会覆盖 html 对 `<style>`/`<script>` 的嵌套）。
 * 以 html 为基础，并为 `lang=scss|sass|less` 注册嵌套语言（默认仅识别空 lang / css）。
 */
function vueLanguageSupport(): Extension {
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

export function languageExtensionForPath(path: string): Extension | null {
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
    return javascript({ typescript: true, jsx: name.endsWith("x") });
  }
  if (
    name.endsWith(".js") ||
    name.endsWith(".jsx") ||
    name.endsWith(".mjs") ||
    name.endsWith(".cjs")
  ) {
    return javascript({ jsx: name.endsWith("x") });
  }
  if (name.endsWith(".json")) return json();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return markdown();
  if (name.endsWith(".html") || name.endsWith(".htm")) {
    return html({ selfClosingTags: true });
  }
  if (name.endsWith(".scss")) return sass();
  if (name.endsWith(".sass")) return sass({ indented: true });
  if (name.endsWith(".less")) return less();
  if (name.endsWith(".css")) return css();
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return yaml();
  if (name.endsWith(".xml") || name.endsWith(".svg")) return xml();
  if (name === ".env" || name.startsWith(".env.")) return envLanguage;
  return null;
}
