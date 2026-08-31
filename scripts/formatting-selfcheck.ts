// ==================== 选区格式化纯函数自测 ====================
// 覆盖内置 Prettier 的 range 参数、不同前端语言以及单次连续 CM change。

import { formatWithBuiltin } from "../src/features/editor/formatting/prettierRuntime.ts";
import { formatBuiltinRangeFallback } from "../src/features/editor/formatting/rangeFallback.ts";
import { singleTextChange } from "../src/features/editor/formatting/textChange.ts";
import { prettierConfigSearchDirs } from "../src/features/editor/formatting/prettierConfigPath.ts";

let failed = 0;
let passed = 0;
function assert(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  }
  else {
    failed += 1;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

async function checkRange(
  name: string,
  filepath: string,
  content: string,
  selected: string,
): Promise<void> {
  const from = content.indexOf(selected);
  const to = from + selected.length;
  let formatted = await formatWithBuiltin(filepath, content, {
    rangeStart: from,
    rangeEnd: to,
  });
  if (!singleTextChange(content, formatted, { from, to })) {
    formatted = await formatBuiltinRangeFallback(filepath, content, { from, to });
  }
  const change = singleTextChange(content, formatted, { from, to });
  assert(`${name} 产生单一选区修改`, change !== null, { formatted, from, to });
  if (!change) return;

  const applied = `${content.slice(0, change.from)}${change.insert}${content.slice(change.to)}`;
  assert(
    `${name} 选区外文本保持不变`,
    applied === formatted &&
      applied.slice(0, from) === content.slice(0, from) &&
      formatted.endsWith(content.slice(to)),
    { formatted, applied },
  );
}

await checkRange(
  "JS",
  "sample.js",
  "const before = 1;\nconst selected={foo:1,bar:[1,2]};\nconst after = 3;\n",
  "const selected={foo:1,bar:[1,2]};",
);
await checkRange(
  "TS",
  "sample.ts",
  "const before = 1;\nconst selected: {foo:number}={foo:1};\nconst after = 3;\n",
  "const selected: {foo:number}={foo:1};",
);
await checkRange(
  "Vue script",
  "sample.vue",
  "<template>\n  <div>stable</div>\n</template>\n<script setup lang=\"ts\">\nconst selected={foo:1}\n</script>\n",
  "const selected={foo:1}",
);
await checkRange(
  "CSS",
  "sample.css",
  ".before { color: red; }\n.selected{color:blue;margin:0}\n.after { color: green; }\n",
  ".selected{color:blue;margin:0}",
);
await checkRange(
  "HTML",
  "sample.html",
  "<p>before</p>\n<div   class=\"selected\"   id=\"demo\">text</div>\n<p>after</p>\n",
  "<div   class=\"selected\"   id=\"demo\">text</div>",
);

const invalid = "const selected = {";
let invalidRejected = false;
try {
  await formatWithBuiltin("sample.ts", invalid, {
    rangeStart: 0,
    rangeEnd: invalid.length,
  });
} catch {
  invalidRejected = true;
}
assert("无效语法抛错且不产生修改", invalidRejected);
assert(
  "空范围不产生 change",
  singleTextChange("same", "same", { from: 0, to: 4 }) === null,
);
assert(
  "嵌套文件从最近目录向工作区根查找 Prettier 配置",
  JSON.stringify(prettierConfigSearchDirs("/repo", "/repo/packages/app/src/main.ts")) ===
    JSON.stringify(["packages/app/src", "packages/app", "packages", "."]),
);
assert(
  "工作区外文件不会越界查找配置",
  JSON.stringify(prettierConfigSearchDirs("/repo", "/other/main.ts")) ===
    JSON.stringify(["."]),
);

console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
