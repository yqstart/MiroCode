import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { vue } from "@codemirror/lang-vue";
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

export function languageExtensionForPath(path: string): Extension | null {
  const name = basename(path).toLowerCase();
  if (name.endsWith(".vue")) return vue();
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
  if (name.endsWith(".css") || name.endsWith(".scss") || name.endsWith(".sass")) {
    return css();
  }
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return yaml();
  if (name.endsWith(".xml") || name.endsWith(".svg")) return xml();
  if (name === ".env" || name.startsWith(".env.")) return envLanguage;
  return null;
}
