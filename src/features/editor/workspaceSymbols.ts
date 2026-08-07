// ==================== 工作区级符号索引（自研简化版 LSP 基础设施） ====================
// 目标：零依赖、零进程、纯前端 LRU 缓存，支持跨文件 go-to-definition /
// find-references / rename symbol。
//
// 设计原则：
// 1. 按需懒构建：首次调用 findDefinition/findReferences 时按需拉文件
// 2. 失败容错：单文件解析失败仅 console.warn，不影响其他
// 3. LRU 上限 500 文件：超出按 Map 插入顺序淘汰
// 4. 内容 hash 失效：内容变化才重建索引（避免 mtime API 依赖）
// 5. 仅解析 TS/JS/JSX/TSX/Vue script 段，CSS/HTML/Markdown 不参与
//
// 范围（明确不做）：类型推断、hover、签名帮助、跨文件补全、服务进程

import { readTextFile } from "@/shared/fs";
import { indexDocumentSymbols, type DocumentSymbol, type SymbolKind } from "@/features/editor/documentSymbols";

/** 单文件解析出的符号表（key = 符号名） */
export type FileSymbolTable = Map<string, DocumentSymbol[]>;

/** 解析失败的文件（避免反复尝试） */
const PARSE_FAIL_MARKER = "__PARSE_FAIL__" as const;

/** 内容 hash（用 djb2 简单实现，足够去重） */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/** 单文件缓存项：内容 hash + 符号表（或失败标记） */
interface FileCacheEntry {
  hash: string;
  symbols: FileSymbolTable | typeof PARSE_FAIL_MARKER;
}

/** 解析单文件：失败返回失败标记，避免反复 IO */
async function parseFile(
  root: string,
  path: string,
): Promise<FileSymbolTable | typeof PARSE_FAIL_MARKER> {
  try {
    const text = await readTextFile(root, path);
    return indexDocumentSymbols(text, path);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[workspaceSymbols] 解析失败：${path}`, err);
    return PARSE_FAIL_MARKER;
  }
}

/** 简化版 LRU：超过上限按 Map 插入顺序淘汰最早的 */
function evictIfNeeded<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

/** 工作区符号索引（单例，全局共享） */
class WorkspaceSymbolCache {
  /** 文件 → 缓存项（LRU，最近访问在最后） */
  private fileCache = new Map<string, FileCacheEntry>();
  /** 全局符号 → 候选位置列表（跨文件聚合） */
  private globalIndex = new Map<string, Array<DocumentSymbol & { path: string }>>();
  /** 标记正在构建（避免重复 IO） */
  private inflight = new Map<string, Promise<FileSymbolTable | typeof PARSE_FAIL_MARKER>>();
  /** LRU 上限 */
  private readonly MAX_FILES = 500;
  /** 文件大小上限（bytes），超出截断避免单文件拖死 */
  private readonly MAX_FILE_BYTES = 1_000_000;

  /** 清空全部缓存（工作区根变更时调用） */
  clear(): void {
    this.fileCache.clear();
    this.globalIndex.clear();
    this.inflight.clear();
  }

  /** 使单文件缓存失效（编辑保存后调用） */
  invalidate(path: string): void {
    const entry = this.fileCache.get(path);
    if (!entry) return;
    this.fileCache.delete(path);
    // 从 globalIndex 移除该文件贡献的符号
    if (entry.symbols !== PARSE_FAIL_MARKER) {
      for (const [name, list] of this.globalIndex.entries()) {
        const filtered = list.filter((d) => d.path !== path);
        if (filtered.length === 0) this.globalIndex.delete(name);
        else if (filtered.length !== list.length) this.globalIndex.set(name, filtered);
      }
    }
  }

  /** 使工作区内所有文件失效（refreshFromDisk / 文件监听触发时调用） */
  invalidateAll(): void {
    this.fileCache.clear();
    this.globalIndex.clear();
  }

  /** 获取单文件符号表（自动构建） */
  async getFileSymbols(root: string, path: string, content?: string): Promise<FileSymbolTable | typeof PARSE_FAIL_MARKER | null> {
    // 已有缓存：用 hash 校验
    if (content !== undefined) {
      const hash = djb2(content);
      const cached = this.fileCache.get(path);
      if (cached && cached.hash === hash && cached.symbols !== PARSE_FAIL_MARKER) {
        this.touch(path);
        return cached.symbols;
      }
      // 内容变了：失效旧条目
      if (cached) this.invalidate(path);
    } else {
      const cached = this.fileCache.get(path);
      if (cached) {
        this.touch(path);
        return cached.symbols;
      }
    }

    // 去重 inflight
    const pending = this.inflight.get(path);
    if (pending) return pending;

    const promise = (async () => {
      // 优先用传进来的 content（避免重复 readTextFile）
      let text: string;
      if (content !== undefined) {
        text = content.length > this.MAX_FILE_BYTES ? content.slice(0, this.MAX_FILE_BYTES) : content;
      } else {
        const read = await readTextFile(root, path);
        text = read.length > this.MAX_FILE_BYTES ? read.slice(0, this.MAX_FILE_BYTES) : read;
      }
      const hash = djb2(text);
      const symbols = await parseFile(root, path);
      this.fileCache.set(path, { hash, symbols });
      this.touch(path);
      evictIfNeeded(this.fileCache, this.MAX_FILES);
      // 合并到 globalIndex（仅成功解析）
      if (symbols !== PARSE_FAIL_MARKER) {
        for (const [name, list] of symbols.entries()) {
          const existing = this.globalIndex.get(name) ?? [];
          for (const sym of list) {
            existing.push({ ...sym, path });
          }
          this.globalIndex.set(name, existing);
        }
      }
      this.inflight.delete(path);
      return symbols;
    })();
    this.inflight.set(path, promise);
    return promise;
  }

  /** 跨文件查找符号定义 */
  async findDefinitionAcrossFiles(
    root: string,
    word: string,
    importerPath: string,
  ): Promise<(DocumentSymbol & { path: string }) | null> {
    // 1) 看 importer 自己 import 了哪些文件，把这些文件的符号表加载进来
    const candidates = await this.loadImportChain(root, importerPath, 5);
    // 2) 在 globalIndex 查 word
    const list = this.globalIndex.get(word);
    if (!list || list.length === 0) return null;
    // 3) 优先选 candidates 集合中的（避免无关同名符号）
    const inChain = list.filter((d) => candidates.has(d.path));
    if (inChain.length > 0) {
      // 优先 function / class / interface，variable 次之
      const ranked = rankDefinitions(inChain);
      return ranked[0] ?? null;
    }
    // 4) fallback：工作区任意位置第一个
    const ranked = rankDefinitions(list);
    return ranked[0] ?? null;
  }

  /** 加载 importer 的 import 链（递归深度上限） */
  private async loadImportChain(
    root: string,
    importerPath: string,
    maxDepth: number,
    depth = 0,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (depth >= maxDepth) return result;
    let content: string;
    try {
      content = await readTextFile(root, importerPath);
    } catch {
      return result;
    }
    // 复用 importReferences 里的 IMPORT_RE 抓 import spec
    const { IMPORT_RE } = await import("@/shared/importReferences");
    const re = new RegExp(IMPORT_RE.source, "g");
    let m: RegExpExecArray | null;
    const specList: string[] = [];
    while ((m = re.exec(content))) {
      const spec = m[1];
      if (spec.startsWith(".") && !specList.includes(spec)) specList.push(spec);
    }
    // 解析每个 spec 到绝对路径，加载其符号表
    for (const spec of specList) {
      const { resolveImportPath } = await import("@/shared/importReferences");
      const resolved = await resolveImportPath(root, importerPath, spec);
      if (resolved && !result.has(resolved)) {
        result.add(resolved);
        await this.getFileSymbols(root, resolved);
        // 递归一层
        const sub = await this.loadImportChain(root, resolved, maxDepth, depth + 1);
        for (const s of sub) result.add(s);
      }
    }
    return result;
  }

  /** 查找所有引用（反向 import 链 + 同文件内） */
  async findAllReferences(
    root: string,
    word: string,
    sourceFile: string,
    sourceContent: string,
  ): Promise<Array<{ path: string; line: number; column: number }>> {
    const result: Array<{ path: string; line: number; column: number }> = [];
    // 1) 同文件内的所有 word 出现
    pushOccurrences(result, sourceFile, sourceContent, word);
    // 2) 反向 import 链：哪些文件 import 了 sourceFile？
    const reverseChain = await this.findReverseImportChain(root, sourceFile, 5);
    for (const importer of reverseChain) {
      try {
        const text = await readTextFile(root, importer);
        pushOccurrences(result, importer, text, word);
      } catch (err) {
        console.warn(`[workspaceSymbols] 反向引用读取失败：${importer}`, err);
      }
    }
    // 3) 也扫一次所有 import 链（symbol import 来的文件可能直接引用 word）
    const forwardChain = await this.loadImportChain(root, sourceFile, 5);
    for (const target of forwardChain) {
      try {
        const text = await readTextFile(root, target);
        pushOccurrences(result, target, text, word);
      } catch {
        /* 容错 */
      }
    }
    // 去重 + 排序
    const seen = new Set<string>();
    const dedup: typeof result = [];
    for (const r of result) {
      const k = `${r.path}:${r.line}:${r.column}`;
      if (!seen.has(k)) {
        seen.add(k);
        dedup.push(r);
      }
    }
    dedup.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
    return dedup;
  }

  /** 找所有 import 了 target 的文件（反向链） */
  private async findReverseImportChain(
    root: string,
    target: string,
    maxDepth: number,
    depth = 0,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (depth >= maxDepth) return result;
    const { IMPORT_RE } = await import("@/shared/importReferences");
    // 收集工作区所有 .ts/.js/.vue 文件（仅 .ts/.js/.vue/.tsx/.jsx）
    // 简单实现：扫工作区根的 listDir（依赖现有的 list_dir Rust 命令）
    const candidates: string[] = [];
    await collectFiles(root, "", candidates, 4);
    for (const file of candidates) {
      try {
        const text = await readTextFile(root, file);
        const re = new RegExp(IMPORT_RE.source, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const spec = m[1];
          if (spec.startsWith(".")) {
            const { resolveImportPath } = await import("@/shared/importReferences");
            const resolved = await resolveImportPath(root, file, spec);
            if (resolved === target && !result.has(file)) {
              result.add(file);
              const sub = await this.findReverseImportChain(root, file, maxDepth, depth + 1);
              for (const s of sub) result.add(s);
            }
          }
        }
      } catch {
        /* 容错 */
      }
    }
    return result;
  }

  /** 调试：导出当前缓存大小 */
  stats(): { files: number; symbols: number; inflight: number } {
    return {
      files: this.fileCache.size,
      symbols: this.globalIndex.size,
      inflight: this.inflight.size,
    };
  }

  /** LRU touch：把最近访问移到 Map 末尾 */
  private touch(key: string): void {
    const entry = this.fileCache.get(key);
    if (!entry) return;
    this.fileCache.delete(key);
    this.fileCache.set(key, entry);
  }
}

/** 把候选按"更可能是定义"排序：function/class/interface/type 优先 */
function rankDefinitions(
  list: Array<DocumentSymbol & { path: string }>,
): Array<DocumentSymbol & { path: string }> {
  const priority: Record<SymbolKind, number> = {
    function: 0,
    class: 1,
    interface: 2,
    type: 3,
    method: 4,
    enum: 5,
    variable: 6,
  };
  return [...list].sort((a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99));
}

/** 在 text 中找出所有 word 的精确出现位置（不依赖任何正则，含全词边界） */
function pushOccurrences(
  out: Array<{ path: string; line: number; column: number }>,
  path: string,
  text: string,
  word: string,
): void {
  if (!word) return;
  // 全词匹配：`\b` 等价于前后不能是 word char
  const wordRe = /[A-Za-z_$][\w$]*/;
  if (!wordRe.test(word)) return;
  const re = new RegExp(`(?<![A-Za-z_$0-9])${escapeRegex(word)}(?![A-Za-z_$0-9])`, "g");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      out.push({ path, line: i + 1, column: (m.index ?? 0) + 1 });
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 递归收集工作区文件（限定扩展名） */
async function collectFiles(
  root: string,
  dir: string,
  out: string[],
  maxDepth: number,
  depth = 0,
): Promise<void> {
  if (depth >= maxDepth) return;
  const { listDir } = await import("@/shared/fs");
  let entries: Array<{ name: string; isDir: boolean; path: string }>;
  try {
    entries = await listDir(root, dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "target") continue;
    if (e.isDir) {
      await collectFiles(root, e.path, out, maxDepth, depth + 1);
    } else if (/\.(ts|tsx|js|jsx|vue)$/.test(e.name)) {
      out.push(e.path);
    }
  }
}

/** 全局单例 */
export const workspaceSymbols = new WorkspaceSymbolCache();
