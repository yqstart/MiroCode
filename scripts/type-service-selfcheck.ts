// ==================== TypeScript 类型服务自测（node --experimental-strip-types scripts/type-service-selfcheck.ts） ====================
// 用真实 typescript 包验证 TsLanguageService 核心能力：
// 真类型感知成员补全（interface/对象字面量/跨文件 import 链）、真自动导入（sourceDisplay）、签名帮助。
// 浏览器与 node 共用同一核心，此测试即核心行为的完成证据。

import ts from "typescript";
import { TsLanguageService, isAlreadyImported, autoImportInsertPos, buildAutoImportApply, type FileContentSource } from "../src/features/editor/typeService/tsService.ts";

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

/** 内存文件源（node 直测） */
function memSource(files: Map<string, string>): FileContentSource {
  return {
    openedContent(path) {
      return files.get(path);
    },
    async readDisk(path) {
      return files.get(path) ?? null;
    },
  };
}

const ROOT = "/proj";
const files = new Map<string, string>([
  ["/proj/types.ts", [
    "export interface User {",
    "  name: string;",
    "  age: number;",
    "  greet(): string;",
    "}",
    "export const PI = 3.14;",
    "export function helper(input: string): number { return input.length; }",
    "export class Store {",
    "  private items: string[] = [];",
    "  add(item: string): void {}",
    "  list(): string[] { return this.items; }",
    "}",
  ].join("\n")],
  ["/proj/main.ts", [
    "import { User, Store } from './types'",
    "const user: User = { name: 'a', age: 1, greet: () => '' }",
    "const store = new Store()",
    "const obj = { alpha: 1, beta: 'x' }",
    "",
    "user.",
  ].join("\n")],
  // 独立文件：连续未完成语句会让 TS 解析退化，每场景一文件贴近真实输入
  ["/proj/obj.ts", "const obj = { alpha: 1, beta: 'x' }\nobj."],
  ["/proj/store.ts", "import { Store } from './types'\nconst store = new Store()\nstore."],
]);

const svc = new TsLanguageService();
svc.init(ts, ROOT, memSource(files));
// 注册两个文件
svc.setFile("/proj/types.ts", files.get("/proj/types.ts")!);
svc.setFile("/proj/main.ts", files.get("/proj/main.ts")!);

// ==================== 真类型感知成员 ====================
console.log("== 类型感知成员 ==");
{
  const doc = files.get("/proj/main.ts")!;
  const pos = doc.lastIndexOf("user.") + "user.".length; // user.| 光标
  const entries = svc.completionsAt("/proj/main.ts", pos);
  const names = entries.map((e) => e.name);
  assert("interface 成员 name", names.includes("name"), names.slice(0, 15));
  assert("interface 成员 age", names.includes("age"));
  assert("interface 方法 greet", names.includes("greet"));
  assert("无对象字面量噪音（alpha 不属于 user）", !names.includes("alpha"));
}

// 对象字面量成员（类型推断，独立文件）
{
  const doc = files.get("/proj/obj.ts")!;
  svc.setFile("/proj/obj.ts", doc);
  const pos = doc.lastIndexOf("obj.") + "obj.".length;
  const entries = svc.completionsAt("/proj/obj.ts", pos);
  const names = entries.map((e) => e.name);
  assert("对象字面量成员 alpha", names.includes("alpha"), names.slice(0, 15));
  assert("对象字面量成员 beta", names.includes("beta"));
}

// class 实例成员（类型推断，独立文件）
{
  const doc = files.get("/proj/store.ts")!;
  svc.setFile("/proj/store.ts", doc);
  const pos = doc.lastIndexOf("store.") + "store.".length;
  const entries = svc.completionsAt("/proj/store.ts", pos);
  const names = entries.map((e) => e.name);
  assert("class 方法 add（类型推断）", names.includes("add"), names.slice(0, 15));
  assert("class 方法 list", names.includes("list"));
  assert("私有成员不暴露", !names.includes("items"));
}

// ==================== 真自动导入 ====================
console.log("== 自动导入 ==");
{
  // 新文件：未导入 helper，输入 hel| 应给出带 sourceDisplay 的补全
  const doc = "hel";
  svc.setFile("/proj/b.ts", doc);
  const entries = svc.completionsAt("/proj/b.ts", doc.length);
  const helper = entries.find((e) => e.name === "helper");
  assert("跨文件未导入符号可见", Boolean(helper));
  assert("自动导入来源模块 './types'", helper?.sourceDisplay === "./types", helper?.sourceDisplay);
  assert("isSnippet 标记存在", typeof helper?.isSnippet === "boolean");
}

// 已导入符号不再重复导入（sourceDisplay 为 undefined？已导入时 TS 不给 sourceDisplay）
{
  const doc = files.get("/proj/main.ts")!;
  const pos = doc.lastIndexOf("import { User, Store }") + 0; // 已有 import
  // 在 main.ts 输入 User 已导入 → 补全 entry 无 sourceDisplay（或已有 import 过滤由前端做）
  const entries = svc.completionsAt("/proj/main.ts", doc.indexOf("const user") + 6);
  const userEntry = entries.find((e) => e.name === "User");
  // TS 对已导入符号返回 sourceDisplay=undefined（无需导入）
  assert("已导入符号无 sourceDisplay", !userEntry?.sourceDisplay, userEntry?.sourceDisplay);
}

// ==================== 签名帮助 ====================
console.log("== 签名帮助 ==");
{
  const doc = [
    "function greet(name: string, age: number): string {",
    "  return name + age",
    "}",
    "greet(",
    "",
  ].join("\n");
  svc.setFile("/proj/sig.ts", doc);
  const pos = doc.lastIndexOf("greet(") + "greet(".length; // greet(| 括号内
  const help = svc.signatureHelpAt("/proj/sig.ts", pos);
  assert("签名帮助存在", Boolean(help));
  assert("签名包含参数 name", help?.signatures[0]?.label.includes("name"), help?.signatures[0]?.label);
  assert("签名包含参数 age", help?.signatures[0]?.label.includes("age"));
  assert("激活参数索引 0", help?.activeParameter === 0, help?.activeParameter);
  assert("applicableSpan 存在（popup 显示范围）", help !== null && help.applicableSpan.length > 0, help?.applicableSpan);
}

// 括号外无签名帮助
{
  const doc = "greet";
  svc.setFile("/proj/sig2.ts", doc);
  const help = svc.signatureHelpAt("/proj/sig2.ts", doc.length);
  assert("括号外无签名帮助", help === null);
}

// ==================== 自动导入 apply（fake view 直接验证插入行为） ====================
console.log("== 自动导入 apply ==");
{
  const doc = "const x = 1\n";
  assert("已导入判定", !isAlreadyImported(doc, "helper"));
  assert("已导入判定（存在 import）", isAlreadyImported("import { helper } from './a'\nconst x = 1", "helper"));
  assert("导入插入点：无 import → 文件开头", autoImportInsertPos("const x = 1\n") === 0);
  assert("导入插入点：首个 import 行尾", autoImportInsertPos("import a from 'b'\nconst x = 1"), "import a from 'b'\n".length);

  // fake view：捕获 dispatch 的事务
  let captured: { changes?: unknown; userEvent?: string } | null = null;
  const fakeView = {
    dispatch: (tr: { changes?: unknown; userEvent?: string }) => {
      captured = tr;
    },
  } as never;

  const apply = buildAutoImportApply(
    { name: "helper", sourceDisplay: "./utils", insertText: "helper" },
    doc,
  ) as (view: typeof fakeView, c: never, from: number, to: number) => void;
  apply(fakeView, null as never, 10, 16);
  assert("apply 插入符号与 import 两处 changes", Array.isArray((captured as { changes: unknown[] }).changes) && (captured as { changes: unknown[] }).changes.length === 2);
  const changes = (captured as { changes: Array<{ from: number; to: number; insert: string }> }).changes;
  assert("符号插入", changes[0].from === 10 && changes[0].to === 16 && changes[0].insert === "helper");
  assert("import 插入到顶部", changes[1].from === 0 && changes[1].insert === "import { helper } from './utils';\n");
  assert("userEvent 标记", captured?.userEvent === "input.complete");

  // 已导入符号：apply 为纯文本（不重复导入）
  const docImported = "import { helper } from './utils'\nconst x = 1\n";
  const apply2 = buildAutoImportApply(
    { name: "helper", sourceDisplay: "./utils" },
    docImported,
  );
  assert("已导入 → 纯文本 apply", typeof apply2 === "string" && apply2 === "helper");

  // 无 sourceDisplay：纯文本
  const apply3 = buildAutoImportApply({ name: "local" }, doc);
  assert("无导入来源 → 纯文本", typeof apply3 === "string");
}

// ==================== 汇总 ====================
console.log(`\n通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
