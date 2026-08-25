// ==================== Git Graph 车道布局 ====================

export interface GraphCommitLike {
  id: string;
  parents?: string[];
}

export interface GraphConnector {
  from: number;
  to: number;
  /** 连接线在当前行中的起始纵坐标（0 = 行顶，0.5 = 节点中心）。 */
  fromY: number;
  /** 连接线在当前行中的结束纵坐标（1 = 行底）。 */
  toY: number;
}

export interface GraphRowLayout {
  id: string;
  lane: number;
  laneCount: number;
  connectors: GraphConnector[];
  /** 当前行开始时各车道等待的提交，便于 hover / 自测和后续扩展。 */
  lanesBefore: string[];
  /** 当前行结束后各车道等待的提交。 */
  lanesAfter: string[];
  merge: boolean;
}

/**
 * 按 Git 的拓扑顺序计算可渲染的多车道图。
 *
 * 算法只依赖提交 id 和父提交，因此筛选后的提交集合也可以独立布局：
 * 不在当前窗口的父提交会继续占据车道，等它重新出现在窗口时自然接上。
 * 每一行的 connector 描述「行顶的既有车道 → 行底的下一车道」，前端只需
 * 用 SVG 画线即可表达分叉、合并和车道横移。
 */
export function layoutGitGraph(commits: GraphCommitLike[]): GraphRowLayout[] {
  const lanes: string[] = [];
  const result: GraphRowLayout[] = [];

  for (const commit of commits) {
    const lanesBefore = [...lanes];
    let lane = lanes.indexOf(commit.id);
    if (lane < 0) {
      // 过滤、浅克隆或非标准 revwalk 都可能让当前提交没有预先登记，
      // 新车道放到最左侧，避免覆盖已有分支。
      lanes.unshift(commit.id);
      lane = 0;
    }

    const next = [...lanes];
    next.splice(lane, 1);

    const parentIds: string[] = [];
    const parents = commit.parents ?? [];
    let insertAt = Math.min(lane, next.length);

    for (const parent of parents) {
      const existing = next.indexOf(parent);
      if (existing >= 0) {
        parentIds.push(parent);
        continue;
      }
      next.splice(insertAt, 0, parent);
      parentIds.push(parent);
      insertAt += 1;
    }

    // 相同的待处理提交只保留一条车道。正常 revwalk 不会产生重复，
    // 但筛选后的提交序列、浅历史和异常 refs 可能会触发该保护。
    const deduped: string[] = [];
    for (const id of next) {
      if (!deduped.includes(id)) deduped.push(id);
    }

    const connectors: GraphConnector[] = [];
    if (lanesBefore[lane] === commit.id) {
      connectors.push({ from: lane, to: lane, fromY: 0, toY: 0.5 });
    }
    // 非当前提交的车道从行顶贯穿到行底；如果因插入父分支而横移，
    // 使用斜线表达车道移动。
    for (let from = 0; from < lanesBefore.length; from += 1) {
      if (from === lane) continue;
      const id = lanesBefore[from];
      const to = deduped.indexOf(id);
      if (to >= 0) {
        connectors.push({ from, to, fromY: 0, toY: 1 });
      }
    }

    // 当前提交从节点中心发散到它的所有父提交。无父提交时不画向下连接线。
    // 这里按父提交 ID 从最终 deduped 车道重新解析，不使用插入时的旧索引：
    // 后续父提交插入可能把已存在的第一父提交挤到右侧。
    for (const parent of parentIds) {
      const to = deduped.indexOf(parent);
      if (to >= 0) {
        connectors.push({ from: lane, to, fromY: 0.5, toY: 1 });
      }
    }

    result.push({
      id: commit.id,
      lane,
      laneCount: Math.max(lanesBefore.length, deduped.length, lane + 1),
      connectors,
      lanesBefore,
      lanesAfter: deduped,
      merge: parents.length > 1,
    });

    lanes.splice(0, lanes.length, ...deduped);
  }

  return result;
}
