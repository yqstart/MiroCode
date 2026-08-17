// ==================== 文档解析缓存（性能层） ====================
// 补全请求不修改文档，同一内容重复全量 parse 是纯浪费（大文件每次按键 O(n)）。
// 按「文件路径 + 内容 hash」缓存 TextDocument 与解析结果，LRU 上限，多文件切换不互相污染。
// djb2 纯函数便于 node 直测。

/** 内容 hash（djb2，与 workspaceSymbols 同算法，足够去重） */
export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/** 通用解析缓存：key=文件路径，内容 hash 未变则复用（LRU 淘汰最旧） */
export class ParseCache<T> {
  private map = new Map<string, { hash: string; value: T }>();
  private readonly limit: number;

  constructor(limit = 8) {
    this.limit = limit;
  }

  /** 命中返回缓存值（含 touch 保活）；未命中或内容已变返回 null */
  get(path: string, text: string): T | null {
    const cached = this.map.get(path);
    if (!cached) return null;
    if (cached.hash !== djb2(text)) {
      // 内容变了：顺手清掉，避免下次 get 重复算 hash
      this.map.delete(path);
      return null;
    }
    // LRU touch：移到末尾
    this.map.delete(path);
    this.map.set(path, cached);
    return cached.value;
  }

  set(path: string, text: string, value: T): void {
    this.map.set(path, { hash: djb2(text), value });
    if (this.map.size > this.limit) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }

  /** 调试：缓存条目数 */
  size(): number {
    return this.map.size;
  }
}
