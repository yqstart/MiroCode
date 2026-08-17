// ==================== TS 类型服务补全源（真类型感知成员 + 真自动导入） ====================
// 接入分派链：script 上下文（非 .vue）优先本源，类型服务未就绪/异常返回 null → 轻量语义兜底。
// 类型感知：obj. 成员来自真实类型推断；未导入符号附带自动导入（VS Code Auto Import）。

import type { Completion, CompletionContext, CompletionSource } from "@codemirror/autocomplete";
import { ensureTypeService, syncOpenedFile, tsService } from "./index";
import { buildAutoImportApply, type TsCompletionEntry } from "./tsService";

/** ts.CompletionEntry.kind（TS 字符串枚举）→ CM6 type */
export function tsKindToCmType(kind: string): Completion["type"] {
  switch (kind) {
    case "function": return "function";
    case "method": return "method";
    case "class": return "class";
    case "interface": return "interface";
    case "property": return "property";
    case "variable": return "variable";
    case "constant": return "constant";
    case "enum": return "enum";
    case "keyword": return "keyword";
    case "type": return "type";
    case "module": return "namespace";
    case "typeParameter": return "type";
    case "member": return "property";
    case "alias": return "type";
    default: return "text";
  }
}

/** 构造 apply：普通项插入文本；自动导入项插入符号 + 顶部 import 语句（逻辑在 tsService 纯函数） */
function buildApply(
  entry: TsCompletionEntry,
  docText: string,
): Completion["apply"] {
  return buildAutoImportApply(entry, docText);
}

/**
 * import spec → 解析结果缓存：磁盘布局跨补全激活稳定，避免每次激活
 * 对每个 spec 重复发起 pathExists IPC（单个 spec 最坏 12 次串行）。
 * 未命中（null）短 TTL 兜底，文件稍后创建时能重新解析。
 */
interface SpecResolveEntry {
  resolved: string | null;
  at: number;
}
const specResolveCache = new Map<string, SpecResolveEntry>();
const NULL_RESOLVE_TTL_MS = 15_000;

function cachedResolveImportPath(
  root: string,
  filePath: string,
  spec: string,
): Promise<string | null> {
  const key = `${filePath}\u0000${spec}`;
  const hit = specResolveCache.get(key);
  if (hit && (hit.resolved !== null || Date.now() - hit.at < NULL_RESOLVE_TTL_MS)) {
    return Promise.resolve(hit.resolved);
  }
  return (async () => {
    const { resolveImportPath } = await import("@/shared/importReferences");
    const resolved = await resolveImportPath(root, filePath, spec);
    if (specResolveCache.size >= 400) {
      const oldest = specResolveCache.keys().next().value;
      if (oldest !== undefined) specResolveCache.delete(oldest);
    }
    specResolveCache.set(key, { resolved, at: Date.now() });
    return resolved;
  })();
}

/** 把已打开 tabs + 当前文件直接 import 链目标注册进类型服务程序 */
async function ensureProgramFiles(filePath: string, docText: string): Promise<void> {
  // 已打开文件全部注册（跨文件类型可见）。setFile 对内容未变的文件
  // 不再递增版本（见 tsService.setFile），此处实际只更新有编辑的文件
  try {
    const { useEditorStore } = await import("@/stores/editor");
    for (const tab of useEditorStore().tabs) {
      if (!/\.vue$/i.test(tab.path)) {
        tsService.setFile(tab.path, tab.content);
      }
    }
  } catch {
    // store 不可用：跳过（当前文件仍在）
  }
  // 当前文件直接 import spec → 解析目标并注册（递归一层足够日常）
  try {
    const { useWorkspaceStore } = await import("@/stores/workspace");
    const root = useWorkspaceStore().rootPath;
    if (!root) return;
    const { IMPORT_RE } = await import("@/shared/importReferences");
    const re = new RegExp(IMPORT_RE.source, "g");
    const specs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(docText))) {
      const spec = m[1];
      if ((spec.startsWith(".") || spec.startsWith("@/")) && !specs.includes(spec)) {
        specs.push(spec);
      }
    }
    for (const spec of specs) {
      try {
        const resolved = await cachedResolveImportPath(root, filePath, spec);
        if (resolved) await tsService.ensureFile(resolved);
      } catch {
        // 单文件失败不影响整体
      }
    }
  } catch {
    // 无工作区：仅当前文件
  }
}

/**
 * 创建类型服务补全源（仅非 .vue 的 script 文件使用）
 */
export function createTsCompletionSource(filePath: string): CompletionSource {
  return async (context: CompletionContext) => {
    const docText = context.state.doc.toString();
    const pos = context.pos;

    // 1. 确保类型服务就绪（惰性加载 typescript；未就绪返回 null 降级）
    if (!tsService.ready) {
      try {
        const { useWorkspaceStore } = await import("@/stores/workspace");
        const root = useWorkspaceStore().rootPath;
        if (!root) return null;
        const ok = await ensureTypeService(root);
        if (!ok) return null;
      } catch {
        return null;
      }
    }

    // 2. 当前文件入程序（版本递增触发增量编译）
    syncOpenedFile(filePath, docText);

    // 3. 程序文件（已打开 + import 链目标）
    try {
      await ensureProgramFiles(filePath, docText);
    } catch {
      // 程序文件不完整也可查询（仅当前文件）
    }

    // 4. 查询补全（同步；异常降级）
    let entries: TsCompletionEntry[];
    try {
      entries = tsService.completionsAt(filePath, pos);
    } catch {
      return null;
    }
    if (!entries.length) return null;

    const word = context.matchBefore(/[\w$]*/);
    const wordFrom = word?.from ?? pos;

    // 5. 转换（最多 60 项；sortText 透传 CM 排序；文档懒加载）
    const options: Completion[] = entries.slice(0, 60).map((e) => {
      const cm: Completion = {
        label: e.name,
        type: tsKindToCmType(e.kind),
        detail: e.labelDetails ?? (e.kindModifiers || undefined),
        sortText: e.sortText,
        boost: 5, // 类型服务项优先于轻量语义
        apply: buildApply(e, docText),
      };
      if (e.sourceDisplay) {
        cm.detail = `${cm.detail ?? "导入"} · ${e.sourceDisplay}`;
      }
      // 文档懒加载（选中时查 completionEntryDetails）
      cm.info = () => {
        const el = document.createElement("div");
        el.className = "miro-completion-doc";
        try {
          const details = tsService.completionDetails(filePath, pos, e.name);
          el.textContent = details?.documentation || e.kindModifiers || e.name;
          if (details?.detail) {
            const d = document.createElement("div");
            d.style.color = "var(--text-muted)";
            d.textContent = details.detail;
            el.prepend(d);
          }
        } catch {
          el.textContent = e.kindModifiers || e.name;
        }
        return el;
      };
      return cm;
    });

    return { from: wordFrom, options, validFor: /^[\w$]*$/ };
  };
}
