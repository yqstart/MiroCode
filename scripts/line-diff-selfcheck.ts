// ==================== 行级 diff 自测（node --experimental-strip-types scripts/line-diff-selfcheck.ts） ====================
// 验证 myersDiff 编辑脚本能正确把 old 重建成 new，并校验 computeLineChanges 的归类输出。

import {
  myersDiff,
  computeLineChanges,
  type LineChange,
} from "../src/features/editor/lineDiff.ts";

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

function assertEq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}\n      got:  ${g}\n      want: ${w}`);
  }
}

/** 用插入内容占位重建；myersDiff 不返回插入内容，改为直接对比重建结果与 b */
function reconstruct(a: string[], ops: ReturnType<typeof myersDiff>, b: string[]): string[] {
  const out: string[] = [];
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    if (op.type === "equal") {
      for (let k = 0; k < op.n; k++) {
        if (a[ai + k] !== b[bi + k]) throw new Error(`equal 内容不一致 @${ai + k}`);
        out.push(a[ai + k]);
      }
      ai += op.n;
      bi += op.n;
    } else if (op.type === "del") {
      ai += op.n;
    } else {
      for (let k = 0; k < op.n; k++) out.push(b[bi + k]);
      bi += op.n;
    }
  }
  if (ai !== a.length || bi !== b.length) throw new Error(`索引未走完 ai=${ai}/${a.length} bi=${bi}/${b.length}`);
  return out;
}

// ==================== 随机重建正确性 ====================
console.log("== 随机重建正确性 ==");
let seed = 42;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function randLine(pool: string[]): string {
  return pool[rand() % pool.length];
}

const POOL = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "", "alpha"];
for (let t = 0; t < 2000; t++) {
  const na = rand() % 12;
  const nb = rand() % 12;
  const a: string[] = [];
  const b: string[] = [];
  for (let i = 0; i < na; i++) a.push(randLine(POOL));
  for (let i = 0; i < nb; i++) b.push(randLine(POOL));
  const ops = myersDiff(a, b);
  const rebuilt = reconstruct(a, ops, b);
  if (JSON.stringify(rebuilt) !== JSON.stringify(b)) {
    assert(`随机 #${t} 重建`, false, { a, b, ops, rebuilt });
    break;
  }
}
assert("2000 组随机 diff 均正确重建", true);

// ==================== 已知归类用例 ====================
console.log("== computeLineChanges 归类 ==");

// 无变化
assertEq("完全相同", computeLineChanges("a\nb\nc", "a\nb\nc"), []);

// 纯新增（空 old）
assertEq("空 old 全部新增", computeLineChanges("", "x\ny"), [
  { line: 1, kind: "added" },
  { line: 2, kind: "added" },
]);

// 单行替换
assertEq("单行替换 → modified", computeLineChanges("a\nb\nc", "a\nB\nc"), [
  { line: 2, kind: "modified" },
]);

// 中间插入一行（纯新增）
assertEq("中间插入 → added", computeLineChanges("a\nc", "a\nb\nc"), [
  { line: 2, kind: "added" },
]);

// 删除一行（无插入）→ deleted 标记在删除点
assertEq("删除一行 → deleted", computeLineChanges("a\nb\nc", "a\nc"), [
  { line: 2, kind: "deleted" },
]);

// 等量两行替换 → 全部 modified
assertEq("等量两行替换 → modified×2", computeLineChanges("a\nb\nc\nd", "a\nX\nY\nd"), [
  { line: 2, kind: "modified" },
  { line: 3, kind: "modified" },
]);

// 1 删 2 插：1 modified + 1 added（net 新增 1 行）
assertEq("1删2插 → modified + added", computeLineChanges("a\nb\nc", "a\nX\nY\nc"), [
  { line: 2, kind: "modified" },
  { line: 3, kind: "added" },
]);

// 2 删 1 插：1 modified + 1 deleted
{
  const r = computeLineChanges("a\nb\nc\nd", "a\nX\nd");
  assertEq("2删1插 → modified + deleted", r, [
    { line: 2, kind: "modified" },
    { line: 2, kind: "deleted" },
  ]);
}

// 末尾换行不产生虚假空行
assertEq("末尾换行不误判", computeLineChanges("a\nb\n", "a\nb\n"), []);
assertEq("末尾换行后新增一行", computeLineChanges("a\n", "a\nb\n"), [
  { line: 2, kind: "added" },
]);

// 首行删除
assertEq("首行删除", computeLineChanges("a\nb\nc", "b\nc"), [
  { line: 1, kind: "deleted" },
]);

// 末行删除：删除点夹到最后一行
assertEq("末行删除", computeLineChanges("a\nb\nc", "a\nb"), [
  { line: 2, kind: "deleted" },
]);

// ==================== 汇总 ====================
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
