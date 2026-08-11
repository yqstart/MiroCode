/**
 * LSP 协议类型定义
 *
 * 复用 vscode-languageserver-protocol 的类型定义（纯协议包，不依赖 VSCode 运行时）。
 * 这里仅做 re-export + 项目内使用的窄类型。
 */

import type {
  Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
  CompletionItem as LspCompletionItem,
  CompletionList,
  Hover,
  SignatureHelp,
  Location,
  Position as LspPosition,
  Range as LspRange,
  TextEdit,
  WorkspaceEdit,
  ServerCapabilities,
  InitializeResult,
} from "vscode-languageserver-protocol";

export type {
  LspDiagnostic,
  LspCompletionItem,
  CompletionList,
  Hover,
  SignatureHelp,
  Location,
  LspPosition,
  LspRange,
  TextEdit,
  WorkspaceEdit,
  ServerCapabilities,
  InitializeResult,
};

export type { DiagnosticSeverity };

/** language server 类型（与 Rust 侧 ServerType 对应） */
export type ServerType = "ts" | "vue";

/** 语言服务标识（与 ServerType 同集合，用于安装/卸载/状态查询） */
export type LanguageId = ServerType;

/** 运行时检测结果（与 Rust 侧 RuntimeCheck 对应） */
export interface RuntimeCheck {
  node: boolean;
  tsLs: boolean;
  volar: boolean;
  /** 已安装的语言服务版本摘要（如 "ts=0.2.0 vue=0.2.0"），无则为 null */
  bundledVersion?: string | null;
}

/** 单语言服务安装状态（与 Rust 侧 LsStatus 对应） */
export interface LsStatus {
  /** 当前平台是否有可用产物（决定「安装」按钮是否可用） */
  supported: boolean;
  /** 已安装版本（未安装为 null） */
  installedVersion: string | null;
  /** 远端最新版本（清单拉取失败/离线为 null） */
  latestVersion: string | null;
  /** 远端清单是否拉取成功 */
  latestAvailable: boolean;
  /** 实际命中的镜像源 id */
  mirrorUsed: string;
  /** 是否有可用更新（已安装 && 远端更新） */
  hasUpdate: boolean;
}

/** 安装进度事件载荷（Rust emit 的 ls://progress） */
export interface LsProgressEvent {
  /** 阶段：manifest / download / verify / extract / done */
  phase: string;
  received: number;
  total: number;
  /** 0-100 */
  percent: number;
  message: string;
}

/** 语言服务镜像源选项 */
export type LsMirror = "auto" | "github" | "ghproxy" | "custom";

/** LSP 连接状态 */
export type LspStatus =
  | "disabled" // 用户关闭
  | "checking" // 正在检测运行时
  | "starting" // 正在启动 server
  | "ready" // 已就绪
  | "unavailable" // 运行时缺失，降级中
  | "error"; // 启动失败

/** LSP 消息事件载荷（Rust emit 的 lsp://message） */
export interface LspMessageEvent {
  serverId: number;
  message: unknown;
}

/** LSP 进程退出事件载荷 */
export interface LspExitEvent {
  serverId: number;
  serverType: ServerType;
  root: string;
}
