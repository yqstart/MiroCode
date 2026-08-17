// ==================== 补全纯函数自测（node --experimental-strip-types scripts/completion-selfcheck.ts） ====================
// 验证 adapters / semanticScanner / vueBindings / vueData 的核心逻辑；
// 不依赖浏览器与编辑器实例，全部同步断言。

import {
  positionToOffset,
  toCmCompletion,
  lspKindToCmType,
  docToText,
  findFirstSnippetPlaceholder,
  stripSnippetPlaceholders,
} from "../src/features/editor/completion/adapters.ts";
import {
  scanLocalSymbols,
  extractObjectMemberNames,
  extractClassMemberNames,
  extractObjectBodyKeys,
} from "../src/features/editor/completion/semanticScanner.ts";
import { extractTemplateBindings, scanScriptSetupBindings, isVueExpressionAt } from "../src/features/editor/completion/vueBindings.ts";
import { VUE_GLOBAL_ATTRIBUTES, VUE_GLOBAL_TAGS, buildVueHtmlData } from "../src/features/editor/completion/vueData.ts";
import { pickBestSymbols } from "../src/features/editor/completion/symbolFilter.ts";
import { boostFromCount, recordMemory, memoryKey } from "../src/features/editor/completion/completionMemory.ts";
import { ParseCache, djb2 } from "../src/features/editor/completion/docCache.ts";
import { relativeImportSpec, nodeModulesPath } from "../src/features/editor/completion/pathUtils.ts";
import { parseSnippetsJson, snippetMatchesScope, languageIdFor } from "../src/features/editor/completion/userSnippets.ts";
import { matchEmmetAbbreviation, indentExpanded, emmetSyntax } from "../src/features/editor/completion/emmet.ts";
import { lineHasOpenParen } from "../src/features/editor/typeService/tsService.ts";

let failed = 0;
let passed = 0;

function assert(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

function assertEq<T>(name: string, actual: T, expected: T): void {
  assert(name, JSON.stringify(actual) === JSON.stringify(expected), {
    actual,
    expected,
  });
}

// ==================== adapters ====================
console.log("== adapters ==");

const doc = "line0\nline1\nline2";
assertEq("positionToOffset 首行", positionToOffset(doc, 0, 3), 3);
assertEq("positionToOffset 第二行", positionToOffset(doc, 1, 2), 8); // 6 + 1(\n) + 2
assertEq("positionToOffset 越界行钳制", positionToOffset(doc, 99, 0), doc.length);
assertEq("positionToOffset 越界列钳制", positionToOffset(doc, 0, 99), 5);

assertEq("kind 映射 function", lspKindToCmType(3), "function");
assertEq("kind 映射 class", lspKindToCmType(7), "class");
assertEq("kind 映射 variable", lspKindToCmType(6), "variable");
assertEq("kind 未知回退 text", lspKindToCmType(999), "text");

const itemWithEdit = {
  label: "div",
  kind: 7,
  sortText: "9-abc",
  textEdit: {
    range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
    newText: "div",
  },
};
const cm1 = toCmCompletion(itemWithEdit as never);
assertEq("TextEdit apply", cm1.apply, "div");
assertEq("TextEdit 类型映射 class", cm1.type, "class");
assertEq("sortText 透传", cm1.sortText, "9-abc");

const itemInsertReplace = {
  label: "x",
  textEdit: {
    insert: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    replace: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
    newText: "xx",
  },
};
const cm2 = toCmCompletion(itemInsertReplace as never);
assertEq("InsertReplace apply", cm2.apply, "xx");

const itemPlain = { label: "foo", insertText: "foo()" };
const cm3 = toCmCompletion(itemPlain as never);
assertEq("无 textEdit apply 用 insertText", cm3.apply, "foo()");
assertEq("无 insertText 用 label", toCmCompletion({ label: "bar" } as never).apply, "bar");

const itemPreselect = { label: "p", preselect: true };
assertEq("preselect → boost", toCmCompletion(itemPreselect as never).boost, 5);

// snippet 占位定位
{
  const p1 = findFirstSnippetPlaceholder('class="$1"');
  assertEq("占位 $1 前后", [p1?.before, p1?.after, p1?.defaultValue], ['class="', '"', ""]);
  const p2 = findFirstSnippetPlaceholder("<div>${1:content}</div>");
  assertEq("占位 ${1:default}", [p2?.before, p2?.after, p2?.defaultValue], ["<div>", "</div>", "content"]);
  assertEq("无占位", findFirstSnippetPlaceholder("plain"), null);
  const p3 = findFirstSnippetPlaceholder("a${2:x}b$1c");
  assertEq("多占位取第一个（after 保留剩余）", [p3?.before, p3?.after], ["a", "b$1c"]);
  assertEq("snippet apply 为函数", typeof toCmCompletion({ label: "x", insertTextFormat: 2, textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'class="$1"' } } as never).apply, "function");
  assertEq("plain apply 为字符串", typeof toCmCompletion({ label: "x" } as never).apply, "string");
}

// ==================== completionMemory ====================
console.log("== completionMemory ==");
assertEq("boostFromCount 封顶", boostFromCount(9), 3);
assertEq("boostFromCount 0", boostFromCount(0), 0);
assertEq("memoryKey", memoryKey("TypeScript", "foo"), "TypeScript:foo");
{
  const map = new Map<string, { count: number; t: number }>();
  recordMemory(map, "a:foo", 100);
  recordMemory(map, "a:foo", 200);
  recordMemory(map, "a:bar", 300);
  assertEq("重复记录累加", map.get("a:foo")?.count, 2);
  assertEq("新条目", map.get("a:bar")?.count, 1);
  // 淘汰最旧：塞满 500 后加一条
  const big = new Map<string, { count: number; t: number }>();
  for (let i = 0; i < 500; i += 1) recordMemory(big, `k${i}`, i);
  recordMemory(big, "newest", 10000);
  assertEq("淘汰后仍 500 条", big.size, 500);
  assertEq("最旧被淘汰", !big.has("k0"), true);
  assertEq("新条目保留", big.has("newest"), true);
}

assertEq("docToText string", docToText("hi"), "hi");
assertEq("docToText MarkupContent", docToText({ kind: "markdown", value: "# t" }), "# t");
assertEq("docToText undefined", docToText(undefined), undefined);

// ==================== semanticScanner ====================
console.log("== semanticScanner ==");

const jsText = [
  "import { a, b as c } from './x'",
  "import d from './y'",
  "const count = 1",
  "let name = 'z'",
  "export function hello() {}",
  "function world() {}",
  "export class Foo {}",
  "interface Bar {}",
  "type Baz = string",
  "export enum Kind {}",
  "  const inner = 2",
  "export default function main() {}",
  "const obj = { alpha: 1, beta }",
  "class Cls { run() {} stop = true }",
  "const after = 3",
].join("\n");

const symbols = scanLocalSymbols(jsText, jsText.length);
const names = symbols.map((s) => s.name);
for (const expect of ["a", "c", "d", "count", "name", "hello", "world", "Foo", "Bar", "Baz", "Kind", "inner", "main"]) {
  assert(`扫描到 ${expect}`, names.includes(expect), names);
}
assert("去重（同名同 kind 只留一）", names.filter((n) => n === "count").length === 1);

// 光标在中间：`after` 之后的声明不可见
const midPos = jsText.indexOf("const after");
const symbolsBefore = scanLocalSymbols(jsText, midPos);
assert("光标前过滤（after 不可见）", !symbolsBefore.some((s) => s.name === "after"));
assert("光标前过滤（inner 可见）", symbolsBefore.some((s) => s.name === "inner"));

assertEq("对象字面量成员", extractObjectMemberNames(jsText, "obj"), ["alpha", "beta"]);
assertEq("class 成员", extractClassMemberNames(jsText, "Cls"), ["run", "stop"]);
assertEq("不存在的对象", extractObjectMemberNames(jsText, "nope"), []);

// 花括号配平 + 嵌套
const nested = "const cfg = { a: 1, b: { c: 2 }, d: [1, { e: 3 }], f: 'g,h' }";
assertEq("嵌套对象成员提取", extractObjectMemberNames(nested, "cfg"), ["a", "b", "d", "f"]);

// 对象体 key 提取（纯函数直测）
assertEq("extractObjectBodyKeys", extractObjectBodyKeys('{ x: 1, "y": 2, z }', 0), ["x", "y", "z"]);

// ==================== vueBindings ====================
console.log("== vueBindings ==");

const vueDoc = [
  "<template>",
  "  <div>{{ count }}</div>",
  "</template>",
  "",
  "<script setup lang=\"ts\">",
  "import { ref, computed } from 'vue'",
  "import { useStore } from './store'",
  "import type { User } from './types'",
  "const count = ref(0)",
  "const doubled = computed(() => count.value * 2)",
  "let name = 'x'",
  "function onClick() {}",
  "const emit = defineEmits<{ change: [v: number] }>()",
  "const props = defineProps<{ msg: string }>()",
  "</script>",
  "",
  "<style scoped>",
  ".foo { color: red }",
  "</style>",
].join("\n");

const bindings = extractTemplateBindings(vueDoc);
const bNames = bindings.map((b) => b.name);
for (const expect of ["ref", "computed", "useStore", "count", "doubled", "name", "onClick", "emit", "props"]) {
  assert(`绑定 ${expect}`, bNames.includes(expect), bNames);
}
const countB = bindings.find((b) => b.name === "count");
assertEq("ref 识别", countB?.kind, "ref");
assertEq("ref detail", countB?.detail, "ref()");
assert("import type 不产生运行时绑定误判", !bindings.some((b) => b.name === "User"));

assertEq("无 script setup 返回空", extractTemplateBindings("<template><div/></template>"), []);

// 表达式上下文判断
{
  const doc = vueDoc; // 上面定义的 SFC
  const inMoustache = doc.indexOf("{{ count }}") + 3; // 在 count 后
  assert("{{ 表达式内", isVueExpressionAt(doc, inMoustache), inMoustache);
  const attrPos = doc.indexOf('<div>{{') + 5; // 普通标签属性（非表达式）
  assert("普通属性非表达式", !isVueExpressionAt(doc, attrPos));
  // 构造 :class 属性值场景
  const doc2 = doc.replace("{{ count }}", '{{ count }}').replace(
    "<div>{{ count }}</div>",
    '<div :class="count">x</div>',
  );
  const classAttr = doc2.indexOf(':class="count"') + ':class="c'.length;
  assert(":attr 属性值内", isVueExpressionAt(doc2, classAttr), doc2.slice(classAttr - 12, classAttr + 2));
  // script 段内不是表达式
  const scriptPos = doc.indexOf("const count") + 5;
  assert("script 段非表达式", !isVueExpressionAt(doc, scriptPos));
  // style 段内不是表达式
  const stylePos = doc.indexOf(".foo") + 2;
  assert("style 段非表达式", !isVueExpressionAt(doc, stylePos));
  // 闭合后的 {{ }} 之后不是表达式
  const closed = doc.indexOf("</div>");
  assert("{{ 闭合后非表达式", !isVueExpressionAt(doc, closed));
}

// ==================== docCache ====================
console.log("== docCache ==");
{
  const cache = new ParseCache<string>(2);
  cache.set("a.ts", "content1", "parsed1");
  assertEq("命中", cache.get("a.ts", "content1"), "parsed1");
  assertEq("内容变化失效", cache.get("a.ts", "content2"), null);
  cache.set("a.ts", "content2", "parsed2");
  assertEq("重设后命中", cache.get("a.ts", "content2"), "parsed2");
  cache.set("b.ts", "b1", "parsed-b");
  cache.set("c.ts", "c1", "parsed-c");
  assertEq("LRU 淘汰最旧", cache.get("a.ts", "content2"), null);
  assertEq("保留最近", cache.get("c.ts", "c1"), "parsed-c");
  assertEq("djb2 稳定", djb2("hello") === djb2("hello") && djb2("hello") !== djb2("hellp"), true);
}

// ==================== pathUtils ====================
console.log("== pathUtils ==");
assertEq("同目录相对路径", relativeImportSpec("/a/src/x/index.ts", "/a/src/x/foo.ts"), "./foo.ts");
assertEq("子目录", relativeImportSpec("/a/src/index.ts", "/a/src/foo/bar.ts"), "./foo/bar.ts");
assertEq("上级目录", relativeImportSpec("/a/src/foo/index.ts", "/a/src/bar.ts"), "../bar.ts");
assertEq("跨多级", relativeImportSpec("/a/src/a/b/c.ts", "/a/src/x/y/z.ts"), "../../x/y/z.ts");
assertEq("不同根（回退无公共前缀）", relativeImportSpec("/a/src/c.ts", "/b/other/d.ts"), "../../b/other/d.ts");

// ==================== emmet ====================
console.log("== emmet ==");
assertEq("行首缩写", matchEmmetAbbreviation("div>ul>li*3"), "div>ul>li*3");
assertEq("前有空格", matchEmmetAbbreviation("  ul.nav"), "ul.nav");
assertEq("行首连续标识符整体作为 tag（VS Code 行为）", matchEmmetAbbreviation("xdiv"), "xdiv");
assertEq("数字开头被拒（防误吞标识符）", matchEmmetAbbreviation("3div"), null);
assertEq("const div 提取 div", matchEmmetAbbreviation("const div"), "div");
assertEq("超长被拒", matchEmmetAbbreviation("a".repeat(81)), null);
assertEq("无缩写", matchEmmetAbbreviation("const x = "), null);
assertEq("缩进对齐（子元素 = 行缩进 + 层级）", indentExpanded("<div>\n\t<p></p>\n</div>", "  "), "<div>\n    <p></p>\n  </div>");
assertEq("两级嵌套", indentExpanded("<div>\n\t<ul>\n\t\t<li></li>\n\t</ul>\n</div>", "  "), "<div>\n    <ul>\n      <li></li>\n    </ul>\n  </div>");
assertEq("单行不处理", indentExpanded("<div></div>", "  "), "<div></div>");
assertEq("html 语法", emmetSyntax("/a/index.html", ""), "html");
assertEq("css 语法", emmetSyntax("/a/style.css", ""), "css");
assertEq("vue template 语法", emmetSyntax("/a/App.vue", "<template>\n  <di"), "html");
assertEq("vue style 段语法", emmetSyntax("/a/App.vue", "<style scoped>\n  .a{"), "css");

// ==================== lineHasOpenParen ====================
console.log("== lineHasOpenParen ===");
assert("函数调用 (", lineHasOpenParen("greet("), "greet(");
assert("多参数", lineHasOpenParen("greet(name, age,"), "greet(name, age,");
assert("嵌套括号", lineHasOpenParen("foo(bar(baz("), "foo(bar(baz(");
assert("已闭合非", !lineHasOpenParen("greet()"), "greet()");
assert("括号外", !lineHasOpenParen("const x = 1"), "const x = 1");
assert("右括号后非", !lineHasOpenParen("foo(a)"), "foo(a)");
assert("空串非", !lineHasOpenParen(""), "");

// ==================== userSnippets ====================
console.log("== userSnippets ==");
{
  const json = JSON.stringify({
    "Log": { prefix: "log", body: ["console.log($1)", ""], description: "打印日志", scope: "javascript,typescript" },
    "VueSetup": { prefix: ["vsetup"], body: "<script setup lang=\"ts\">\n$1\n</script>", scope: "vue" },
    "通用": { prefix: "note", body: "// NOTE: $1" },
    "非法项": { prefix: 123, body: "x" },
    "空项": { prefix: "", body: "y" },
  });
  const snippets = parseSnippetsJson(json);
  assertEq("解析条数（非法/空跳过）", snippets.length, 3);
  const log = snippets.find((s) => s.name === "Log");
  assertEq("body 数组转多行", log?.body, "console.log($1)\n");
  assertEq("scope 解析", log?.scope, ["javascript", "typescript"]);
  assert("scope 匹配 js", snippetMatchesScope(log!, "javascript"));
  assert("scope 匹配 ts", snippetMatchesScope(log!, "typescript"));
  assert("scope 不匹配 html", !snippetMatchesScope(log!, "html"));
  const generic = snippets.find((s) => s.name === "通用");
  assert("无 scope 全语言匹配", snippetMatchesScope(generic!, "json"));
  assertEq("非法 JSON", parseSnippetsJson("not json"), []);
  assertEq("languageIdFor ts", languageIdFor("/a/x.ts"), "typescript");
  assertEq("languageIdFor jsx", languageIdFor("/a/x.jsx"), "javascript");
  assertEq("languageIdFor vue", languageIdFor("/a/x.vue"), "vue");
  assertEq("languageIdFor 未知", languageIdFor("/a/x.xyz"), "");
}

// ==================== nodeModulesPath ====================
console.log("== nodeModulesPath ==");
assertEq("顶层包", nodeModulesPath("/p", "reac"), { dirPath: "/p/node_modules", prefix: "reac" });
assertEq("包内子路径", nodeModulesPath("/p", "lodash/merge"), { dirPath: "/p/node_modules/lodash", prefix: "merge" });
assertEq("scope 列包", nodeModulesPath("/p", "@vue/"), { dirPath: "/p/node_modules/@vue", prefix: "" });
assertEq("scope 下包", nodeModulesPath("/p", "@vue/runtime"), { dirPath: "/p/node_modules/@vue", prefix: "runtime" });
assertEq("scope 包内", nodeModulesPath("/p", "@vue/runtime-core/dist"), { dirPath: "/p/node_modules/@vue/runtime-core", prefix: "dist" });

// ==================== symbolFilter ====================
console.log("== symbolFilter ==");

const fakeIndex = new Map<string, Array<{ name: string; line: number; column: number; kind: string; path: string }>>();
fakeIndex.set("FetchUser", [
  { name: "FetchUser", line: 1, column: 1, kind: "function", path: "src/a.ts" },
  { name: "FetchUser", line: 5, column: 1, kind: "variable", path: "src/b.ts" },
]);
fakeIndex.set("fetchPosts", [
  { name: "fetchPosts", line: 2, column: 1, kind: "function", path: "src/c.ts" },
]);
fakeIndex.set("USER_LIMIT", [
  { name: "USER_LIMIT", line: 3, column: 1, kind: "variable", path: "src/d.ts" },
]);
fakeIndex.set("unrelated", [
  { name: "unrelated", line: 9, column: 1, kind: "variable", path: "src/e.ts" },
]);

const hits = pickBestSymbols(fakeIndex as never, "fetch");
assertEq("前缀过滤", hits.map((h) => h.name).sort(), ["FetchUser", "fetchPosts"].sort());
assert("大小写不敏感（fetch 命中 FetchUser）", hits.some((h) => h.name === "FetchUser"));
const fetchUser = hits.find((h) => h.name === "FetchUser");
assertEq("同符号取 function 优先", fetchUser?.kind, "function");
assertEq("命中带来源文件", fetchUser?.path, "src/a.ts");

const limited = pickBestSymbols(fakeIndex as never, "fetch", 1);
assertEq("limit 生效", limited.length, 1);
assertEq("空前缀返回空", pickBestSymbols(fakeIndex as never, "").length, 0);

// ==================== vueData ====================
console.log("== vueData ==");

assert("Vue 指令 data 含 v-if/v-model", VUE_GLOBAL_ATTRIBUTES.some((a) => a.name === "v-if") && VUE_GLOBAL_ATTRIBUTES.some((a) => a.name === "v-model"));
assert("Vue 元素 data 含 transition", VUE_GLOBAL_TAGS.some((t) => t.name === "transition"));
const data = buildVueHtmlData();
assertEq("buildVueHtmlData version", data.version, 1);
assert("buildVueHtmlData tags 有 attributes 字段", data.tags.every((t) => Array.isArray(t.attributes)));

// ==================== 汇总 ====================
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
