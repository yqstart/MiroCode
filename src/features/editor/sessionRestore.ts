/** 把活动标签移到读取队列首位，但不修改持久化会话中的原始标签顺序。 */
export function prioritizeActiveTab<T extends { path: string }>(
  tabs: readonly T[],
  activePath: string | null,
): T[] {
  const copy = [...tabs];
  if (!activePath) return copy;
  const index = copy.findIndex((tab) => tab.path === activePath);
  if (index <= 0) return copy;
  const [active] = copy.splice(index, 1);
  return [active, ...copy];
}

/**
 * 保持输入顺序的限流并发映射。会话恢复用它限制同时进行的磁盘读取，
 * 避免几十个标签一次性占满 Tauri 的阻塞线程池和磁盘队列。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("并发数必须是正整数");
  }
  if (!items.length) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.floor(concurrency), items.length);

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
