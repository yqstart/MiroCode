/**
 * 行级 diff（Myers O(ND)）：用于编辑器 gutter 改动条。
 * - 纯前端计算 buffer 与 HEAD 文本的逐行差异，随输入实时更新（对齐 VS Code）。
 * - 输出「新文档」坐标下的改动行：added（新增）/ modified（修改）/ deleted（删除点）。
 */

export type GitChangeKind = "added" | "modified" | "deleted";

export interface LineChange {
  /** 1-based 行号（新文档）；deleted 表示删除点所在的新文档行 */
  line: number;
  kind: GitChangeKind;
}

type ROp = { type: "equal" | "del" | "ins"; n: number };

/** 拆行；去掉「末尾换行」产生的空行，避免误判为新增空行。空文本视为 0 行 */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Myers 差异算法，返回运行长度编码的编辑脚本（equal / del / ins） */
export function myersDiff(a: string[], b: string[]): ROp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  let dEnd = -1;

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset];
      } else {
        x = v[k - 1 + offset] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        dEnd = d;
        break outer;
      }
    }
  }

  // 回溯：先撤销蛇形（equal），再撤销一步（del/ins）
  const raw: ROp[] = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK: number;
    if (d === 0) {
      prevK = 0;
    } else if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
      prevK = k + 1; // 上一步是向下（插入 b 行）
    } else {
      prevK = k - 1; // 上一步是向右（删除 a 行）
    }
    const prevX = v[prevK + offset];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      raw.push({ type: "equal", n: 1 });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (prevK === k + 1) {
        raw.push({ type: "ins", n: 1 });
        y -= 1;
      } else {
        raw.push({ type: "del", n: 1 });
        x -= 1;
      }
    }
  }
  raw.reverse();

  // 合并相邻同类型
  const merged: ROp[] = [];
  for (const op of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) last.n += 1;
    else merged.push({ ...op });
  }
  return merged;
}

/**
 * 计算新文档坐标下的改动行。
 * 相邻的「删除+插入」块按 VS Code 约定归类：
 * - 成对的删除/插入 → modified（蓝）
 * - 多出的插入 → added（绿）
 * - 多出的删除 → deleted（红三角，标记在删除点所在行）
 */
export function computeLineChanges(oldText: string, newText: string): LineChange[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = myersDiff(a, b);
  const changes: LineChange[] = [];

  let oldIdx = 0;
  let newIdx = 0;
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];
    if (op.type === "equal") {
      oldIdx += op.n;
      newIdx += op.n;
      i += 1;
      continue;
    }

    // 收集一段连续的 del/ins（中间无 equal）作为一个改动块
    const insNewLines: number[] = [];
    let dels = 0;
    const delAnchorNewLine = newIdx + 1; // 删除点：1-based 新文档行号（删除发生处）
    while (i < ops.length && ops[i].type !== "equal") {
      const o = ops[i];
      if (o.type === "del") {
        dels += o.n;
        oldIdx += o.n;
      } else {
        for (let k = 0; k < o.n; k++) {
          insNewLines.push(newIdx + 1 + k); // 1-based
        }
        newIdx += o.n;
      }
      i += 1;
    }

    const matched = Math.min(dels, insNewLines.length);
    for (let k = 0; k < matched; k++) {
      changes.push({ line: insNewLines[k], kind: "modified" });
    }
    for (let k = matched; k < insNewLines.length; k++) {
      changes.push({ line: insNewLines[k], kind: "added" });
    }
    if (dels > insNewLines.length) {
      changes.push({
        line: clampLine(delAnchorNewLine, b.length),
        kind: "deleted",
      });
    }
  }

  return changes;
}

/** 删除点行号夹到 [1, 文档行数]；空文档时落到 1 */
function clampLine(line: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(Math.max(1, line), total);
}
