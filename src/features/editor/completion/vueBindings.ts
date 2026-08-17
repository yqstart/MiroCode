// ==================== Vue SFC script setup 绑定提取 ====================
// 从 <script setup> 段提取顶层绑定（const/let/var/function/import 及 ref 标记），
// 供 template 表达式补全（{{ x }}、:prop="x"、@click="x" 等）。
// 纯函数、零 @/ 依赖，便于 node 直测。v1 只处理单行声明，不做多行/解构细化。

export interface ScriptSetupBinding {
  name: string;
  kind: "variable" | "function" | "import" | "ref";
  /** 展示用摘要（如 ref(0) / const / import） */
  detail: string;
}

const WORD = "[A-Za-z_$][\\w$]*";

/** 提取 <script setup> 段文本（lang=ts 也兼容） */
export function extractScriptSetupText(doc: string): string | null {
  const openRe = /<script\s+([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(doc))) {
    const attrs = m[1] ?? "";
    if (!/\bsetup\b/.test(attrs)) continue;
    const bodyStart = m.index + m[0].length;
    const closeIdx = doc.indexOf("</script>", bodyStart);
    if (closeIdx < 0) return null;
    return doc.slice(bodyStart, closeIdx);
  }
  return null;
}

/** 从 script setup 文本中提取顶层绑定 */
export function scanScriptSetupBindings(scriptText: string): ScriptSetupBinding[] {
  const out: ScriptSetupBinding[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: ScriptSetupBinding["kind"], detail: string): void => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, kind, detail });
  };

  const lines = scriptText.split("\n");
  for (const line of lines) {
    // import type 不生成运行时绑定（template 表达式不可用），跳过
    if (/^\s*import\s+type\b/.test(line)) continue;

    // import { a, b } from / import a from
    let m = line.match(new RegExp(`^\\s*import\\s*\\{([^}]*)\\}\\s+from`));
    if (m?.[1]) {
      for (const name of bindingNames(m[1])) push(name, "import", "import");
      continue;
    }
    m = line.match(new RegExp(`^\\s*import\\s+(${WORD})\\s+from`));
    if (m?.[1]) {
      push(m[1], "import", "import");
      continue;
    }

    // const count = ref(0) / reactive / computed / shallowRef ...
    m = line.match(new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(${WORD})\\s*=\\s*(?:await\\s+)?(ref|shallowRef|reactive|computed|shallowReactive|readonly)\\s*\\(`));
    if (m?.[1]) {
      push(m[1], "ref", `${m[2]}()`);
      continue;
    }

    // const x = ... / let / var（普通绑定）
    m = line.match(new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(${WORD})\\s*=`));
    if (m?.[1]) {
      push(m[1], "variable", "variable");
      continue;
    }

    // function f() / async function f()
    m = line.match(new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+(${WORD})`));
    if (m?.[1]) {
      push(m[1], "function", "function");
      continue;
    }

    // const emit = defineEmits / const props = defineProps / defineModel / defineExpose
    m = line.match(new RegExp(`^\\s*(?:const|let|var)\\s+(${WORD})\\s*=\\s*(?:defineEmits|defineProps|defineModel|useSlots|useAttrs)\\s*\\(`));
    if (m?.[1]) {
      push(m[1], "ref", "macro");
      continue;
    }

    // defineProps / defineEmits 裸调用（无绑定）
    // v1 不处理；template 中 $props/$emit 由运行时提供
  }

  // defineExpose / defineOptions 不影响绑定
  return out;
}

/** import 绑定名提取（`a as b` 取 b；默认导出名保留） */
function bindingNames(bindText: string): string[] {
  const out: string[] = [];
  for (const raw of bindText.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(new RegExp(`(${WORD})(?:\\s+as\\s+(${WORD}))?$`));
    if (m) out.push(m[2] ?? m[1]);
  }
  return out;
}

/**
 * 从 Vue SFC 全文提取 template 可用的绑定（无 script setup 时返回空数组）
 * 供 template 表达式补全源使用。
 */
export function extractTemplateBindings(doc: string): ScriptSetupBinding[] {
  const script = extractScriptSetupText(doc);
  if (script === null) return [];
  return scanScriptSetupBindings(script);
}

/** 是否位于 Vue SFC 的 template 段（按最近启闭标签字符串判断） */
export function isVueTemplateAt(doc: string, pos: number): boolean {
  const before = doc.slice(0, pos);
  const openTemplate = before.lastIndexOf("<template");
  const closeTemplate = before.lastIndexOf("</template>");
  if (openTemplate >= 0 && openTemplate > closeTemplate) return true;
  const openScript = before.lastIndexOf("<script");
  const closeScript = before.lastIndexOf("</script>");
  if (openScript >= 0 && openScript > closeScript) return false;
  const openStyle = before.lastIndexOf("<style");
  const closeStyle = before.lastIndexOf("</style>");
  if (openStyle >= 0 && openStyle > closeStyle) return false;
  return openTemplate >= 0;
}

/**
 * 是否位于 template 表达式上下文：`{{ 表达式内` 或 `:attr="expr` / `@event="expr` / `v-*="expr` 属性值内
 * （行内判断，v1 不做跨行引号配平）
 */
export function isVueExpressionAt(doc: string, pos: number): boolean {
  if (!isVueTemplateAt(doc, pos)) return false;
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  const beforeLine = doc.slice(lineStart, pos);
  // {{ 表达式内（本行 {{ 尚未闭合）
  const openM = beforeLine.lastIndexOf("{{");
  const closeM = beforeLine.lastIndexOf("}}");
  if (openM > closeM) return true;
  // 属性值内：`:attr="expr` / `@event="expr` / `v-bind:attr="expr`（引号未闭合）
  if (/(?::[\w.-]*|@[\w.-]*|v-[a-z-]+)=["'][^"']*$/.test(beforeLine)) return true;
  return false;
}
