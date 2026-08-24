export interface SingleTextChange {
  from: number;
  to: number;
  insert: string;
}

export interface TextChangeRange {
  from: number;
  to: number;
}

/** 将格式化前后的全文本压缩为一个连续修改，交给 CM 维护撤销与选区映射。 */
export function singleTextChange(
  before: string,
  after: string,
  allowedRange?: TextChangeRange,
): SingleTextChange | null {
  if (before === after) return null;

  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before.charCodeAt(from) === after.charCodeAt(from)
  ) {
    from += 1;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > from &&
    afterEnd > from &&
    before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  // Prettier 可能为了语法完整性扩展 range；扩展到选区外时不提交部分结果，
  // 避免「格式化选区」意外改动选区外文本。
  if (
    allowedRange &&
    (from < allowedRange.from || beforeEnd > allowedRange.to)
  ) {
    return null;
  }

  return {
    from,
    to: beforeEnd,
    insert: after.slice(from, afterEnd),
  };
}
