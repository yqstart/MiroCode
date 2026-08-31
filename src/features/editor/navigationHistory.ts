import type { EditorJumpTarget } from "@/shared/types";

export interface NavigationHistoryState {
  back: EditorJumpTarget[];
  forward: EditorJumpTarget[];
}
const MAX_HISTORY = 50;

function sameTarget(left: EditorJumpTarget, right: EditorJumpTarget): boolean {
  return (
    left.path === right.path &&
    left.line === right.line &&
    left.column === right.column
  );
}

function pushUnique(stack: EditorJumpTarget[], target: EditorJumpTarget): void {
  const last = stack[stack.length - 1];
  if (last && sameTarget(last, target)) return;
  stack.push(target);
  if (stack.length > MAX_HISTORY) stack.shift();
}

/** 普通跳转会写入后退栈，并使旧的前进分支失效。 */
export function recordNavigation(
  history: NavigationHistoryState,
  current: EditorJumpTarget,
): void {
  pushUnique(history.back, current);
  history.forward.splice(0);
}

/** 返回上一位置，同时把当前位置写入前进栈。 */
export function takeNavigationBack(
  history: NavigationHistoryState,
  current: EditorJumpTarget | null,
): EditorJumpTarget | null {
  const target = history.back.pop() ?? null;
  if (!target) return null;
  if (current) pushUnique(history.forward, current);
  return target;
}

/** 返回下一位置，同时把当前位置重新写回后退栈。 */
export function takeNavigationForward(
  history: NavigationHistoryState,
  current: EditorJumpTarget | null,
): EditorJumpTarget | null {
  const target = history.forward.pop() ?? null;
  if (!target) return null;
  if (current) pushUnique(history.back, current);
  return target;
}
