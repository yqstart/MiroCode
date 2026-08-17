// ==================== 编辑器输入链路微基准（node --experimental-strip-types scripts/perf/editor-input-bench.ts） ====================
// 度量阶段 A 优化的核心热点：导航装饰的符号索引（记忆化）、轻量语义扫描（记忆化）。
// 关注「重复激活」成本：光标移动/弹层重开等场景下 doc 未变，命中缓存应显著低于冷重建。
// 输出均为「每次调用的平均耗时」（µs），非断言脚本；数值随机器浮动，看相对量级。

import {
  indexDocumentSymbols,
  findSymbolDefinition,
} from "../../src/features/editor/documentSymbols.ts";
import {
  scanLocalSymbols,
  extractObjectMemberNames,
  extractClassMemberNames,
} from "../../src/features/editor/completion/semanticScanner.ts";

/** 冷测量：不做预热，直接计一轮（缓存为空的真实首建成本） */
function benchCold(name: string, iterations: number, fn: () => void): void {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const per = ((performance.now() - start) / iterations) * 1000;
  console.log(`  [冷] ${name.padEnd(40)} ${iterations} 次  →  ${per.toFixed(2)}µs/次`);
}

/** 热测量：先预热 100 次填充缓存，再计一轮（重复激活的真实成本） */
function benchWarm(name: string, iterations: number, fn: () => void): void {
  for (let i = 0; i < 100; i += 1) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const per = ((performance.now() - start) / iterations) * 1000;
  console.log(`  [热] ${name.padEnd(40)} ${iterations} 次  →  ${per.toFixed(2)}µs/次`);
}

// ---------- 生成测试文档 ----------
function genTsFile(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    if (i % 20 === 0) {
      out.push(`export function fn_${i}(a: number, b: string): void { const x = ${i}; }`);
    } else if (i % 7 === 0) {
      out.push(`const cfg_${i} = { alpha: 1, beta: 2, gamma: "${i}" };`);
    } else {
      out.push(`  // 普通行 ${i}：let value = compute(${i}); value += 1;`);
    }
  }
  return out.join("\n");
}

function genVueFile(lines: number): string {
  const body: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    body.push(i % 15 === 0 ? `function handler_${i}() { return ${i}; }` : `  const v_${i} = ${i};`);
  }
  return [
    "<template>",
    '  <div class="panel" @click="handler_0">',
    "    <span>{{ title }}</span>",
    "  </div>",
    "</template>",
    "<script setup lang=\"ts\">",
    ...body,
    "</script>",
    "<style scoped>",
    "  .panel { color: red; }",
    "</style>",
  ].join("\n");
}

const TS_PATH = "/tmp/bench-sample.ts";
const VUE_PATH = "/tmp/bench-sample.vue";

console.log("== 文档规模 ==");
const tsDoc = genTsFile(4000);
const vueDoc = genVueFile(2000);
console.log(`  TS 文档 ${tsDoc.length.toLocaleString()} 字符 / ${tsDoc.split("\n").length} 行`);
console.log(`  Vue 文档 ${vueDoc.length.toLocaleString()} 字符 / ${vueDoc.split("\n").length} 行`);

// 注意顺序：同一 key 的冷测量必须在热测量之前（缓存只能被后续调用命中）
console.log("\n== A1 导航装饰：符号索引（记忆化） ==");
benchCold("indexDocumentSymbols 首建 4000 行索引", 3, () => {
  indexDocumentSymbols(tsDoc, TS_PATH);
});
benchWarm("indexDocumentSymbols 同引用（光标移动）", 2000, () => {
  indexDocumentSymbols(tsDoc, TS_PATH);
});
benchCold("findSymbolDefinition 光标移动（首建）", 3, () => {
  findSymbolDefinition(tsDoc, 100_000, TS_PATH);
});
benchWarm("findSymbolDefinition 光标移动（热命中）", 2000, () => {
  findSymbolDefinition(tsDoc, 100_000, TS_PATH);
});
benchCold("indexDocumentSymbols Vue 首建", 3, () => {
  indexDocumentSymbols(vueDoc, VUE_PATH);
});
benchWarm("indexDocumentSymbols Vue 热命中", 2000, () => {
  indexDocumentSymbols(vueDoc, VUE_PATH);
});
benchWarm("内容微变（同长度新串，hash+重建）", 20, () => {
  indexDocumentSymbols(tsDoc + " ", TS_PATH);
});

console.log("\n== A4 轻量语义扫描（记忆化） ==");
benchCold("scanLocalSymbols 首扫（光标前 2000 行）", 3, () => {
  scanLocalSymbols(tsDoc, 100_000);
});
benchWarm("scanLocalSymbols 热命中（同光标位置）", 2000, () => {
  scanLocalSymbols(tsDoc, 100_000);
});
benchCold("extractObjectMemberNames 首扫", 3, () => {
  extractObjectMemberNames(tsDoc, "cfg_1001");
});
benchWarm("extractObjectMemberNames 热命中", 2000, () => {
  extractObjectMemberNames(tsDoc, "cfg_1001");
});
benchCold("extractClassMemberNames 首扫", 3, () => {
  extractClassMemberNames(tsDoc, "Cls");
});
benchWarm("extractClassMemberNames 热命中", 2000, () => {
  extractClassMemberNames(tsDoc, "Cls");
});

console.log("\n完成。解读：");
console.log("  - 导航装饰路径（navigation.ts）：纯光标移动时 doc 字符串按 Text 引用复用，");
console.log("    indexDocumentSymbols 走同引用分支，热命中应接近 0（优化前每次全量重建索引）。");
console.log("  - 语义扫描（semanticScanner.ts）：热命中省去逐行正则扫描，但需先算内容 hash");
console.log("    （O(n)，~65µs/215KB），故热命中为 hash 成本而非 0。");
