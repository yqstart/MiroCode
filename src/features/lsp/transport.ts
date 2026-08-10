/**
 * LSP 传输层：Tauri invoke 发送 + listen 接收
 *
 * 封装与 Rust 侧 commands/lsp.rs 的通信：
 * - 发送：invoke 调用 lsp_send_request / lsp_send_notification / lsp_send_response
 * - 接收：listen 监听 lsp://message / lsp://exit / lsp://stderr 事件
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  LsMirror,
  LsProgressEvent,
  LsStatus,
  RuntimeCheck,
  ServerType,
} from "./types";

// ==================== 语言服务捆绑包 ====================

/**
 * 查询语言服务捆绑包状态（本地安装版本 + 远端最新版本）。
 * 参数 camelCase 会自动映射到 Rust 侧 snake_case 同名参数。
 */
export async function getLsStatus(
  mirror: LsMirror,
  customBase?: string | null,
): Promise<LsStatus> {
  return invoke<LsStatus>("ls_status", { mirror, customBase: customBase ?? null });
}

/** 一键安装 / 更新语言服务捆绑包，返回激活版本 */
export async function installLs(
  mirror: LsMirror,
  customBase?: string | null,
): Promise<string> {
  return invoke<string>("ls_install", { mirror, customBase: customBase ?? null });
}

/** 卸载语言服务捆绑包 */
export async function uninstallLs(): Promise<void> {
  return invoke("ls_uninstall");
}

/** 监听语言服务安装进度 */
export async function onLsProgress(
  handler: (event: LsProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<LsProgressEvent>("ls://progress", (e) => handler(e.payload));
}

// ==================== invoke 封装 ====================

/** 检测宿主运行时 */
export async function checkRuntime(): Promise<RuntimeCheck> {
  return invoke<RuntimeCheck>("lsp_check_runtime");
}

/** 启动 language server，返回 server_id */
export async function startServer(
  serverType: ServerType,
  root: string,
): Promise<number> {
  return invoke<number>("lsp_start", { serverType, root });
}

/** 发送 JSON-RPC 请求（带 id，等待响应） */
export async function sendRequest(
  serverId: number,
  id: number,
  method: string,
  params?: unknown,
): Promise<void> {
  return invoke("lsp_send_request", {
    serverId,
    id,
    method,
    params: params ?? null,
  });
}

/** 发送 JSON-RPC 通知（无 id，不等待响应） */
export async function sendNotification(
  serverId: number,
  method: string,
  params?: unknown,
): Promise<void> {
  return invoke("lsp_send_notification", {
    serverId,
    method,
    params: params ?? null,
  });
}

/** 响应 server 发来的反向请求 */
export async function sendResponse(
  serverId: number,
  id: unknown,
  result: unknown,
): Promise<void> {
  return invoke("lsp_send_response", { serverId, id, result });
}

/** 停止单个 server */
export async function stopServer(serverId: number): Promise<void> {
  return invoke("lsp_stop", { serverId });
}

/** 停止全部 server */
export async function stopAllServers(): Promise<void> {
  return invoke("lsp_stop_all");
}

// ==================== listen 封装 ====================

/** 监听 LSP 消息（server -> 前端） */
export async function onLspMessage(
  handler: (event: { serverId: number; message: unknown }) => void,
): Promise<UnlistenFn> {
  return listen<{ serverId: number; message: unknown }>(
    "lsp://message",
    (e) => handler(e.payload),
  );
}

/** 监听 server 进程退出 */
export async function onLspExit(
  handler: (event: {
    serverId: number;
    serverType: ServerType;
    root: string;
  }) => void,
): Promise<UnlistenFn> {
  return listen<{
    serverId: number;
    serverType: ServerType;
    root: string;
  }>("lsp://exit", (e) => handler(e.payload));
}

/** 监听 server stderr 日志（调试用） */
export async function onLspStderr(
  handler: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("lsp://stderr", (e) => handler(e.payload));
}

// ==================== JSON-RPC id 生成器 ====================

/** 全局请求 id 生成器（每个 server 独立计数器更合理，但全局也可） */
let nextRequestId = 1;

export function allocRequestId(): number {
  return nextRequestId++;
}
