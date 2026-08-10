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

/** 运行时检测结果（与 Rust 侧 RuntimeCheck 对应） */
export interface RuntimeCheck {
  node: boolean;
  tsLs: boolean;
  volar: boolean;
  /** 内置语言服务捆绑包版本（非空表示 LSP 由内置 Node + server 驱动，不依赖宿主环境） */
  bundledVersion?: string | null;
}

/** 语言服务捆绑包安装状态（与 Rust 侧 LsStatus 对应） */
export interface LsStatus {
  /** 当前平台是否有可用产物 */
  supported: boolean;
  /** 已安装版本（未安装为 null） */
  installedVersion: string | null;
  /** 远端最新版本（清单拉取失败/离线为 null） */
  latestVersion: string | null;
  /** 远端清单是否拉取成功 */
  latestAvailable: boolean;
  /** 实际命中的镜像源 id */
  mirrorUsed: string;
  /** 是否有可用更新 */
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
