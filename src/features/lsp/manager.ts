/**
 * LSP Manager：多 server 管理 + 文件类型路由
 *
 * 职责：
 * - 按工作区启动 / 停止 language server（ts + vue）
 * - 按文件扩展名路由请求到正确的 server
 * - 全局消息分发（从 transport 收到消息 -> 路由到对应 LanguageClient）
 * - 对外暴露统一的 LSP 能力接口（hover/completion/diagnostic/...）
 */

import { onLspExit, onLspMessage, startServer, stopAllServers } from "./transport";
import { LanguageClient, getLanguageId, pathToUri, uriToPath } from "./client";
import { detectRuntime } from "./nodeDetector";
import type { LspStatus, ServerType } from "./types";
import type { UnlistenFn } from "@tauri-apps/api/event";

// ==================== 类型 ====================

/** 诊断回调 */
export type DiagnosticsHandler = (
  uri: string,
  diagnostics: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    severity?: number;
    message?: string;
    source?: string;
  }>,
) => void;

// ==================== LspManager 单例 ====================

class LspManagerImpl {
  /** 已启动的 client（serverType -> LanguageClient） */
  private clients = new Map<ServerType, LanguageClient>();
  /** 当前工作区根 */
  private root: string | null = null;
  /** 状态 */
  private _status: LspStatus = "disabled";
  /** 是否已初始化（事件监听已注册） */
  private initialized = false;
  /** 事件取消监听函数 */
  private unlistenFns: UnlistenFn[] = [];
  /** 诊断回调列表 */
  private diagnosticsHandlers: DiagnosticsHandler[] = [];
  /** 是否启用（用户设置） */
  private enabled = true;

  /** 获取当前状态 */
  get status(): LspStatus {
    return this._status;
  }

  /** 是否有可用的 LSP（至少一个 server 已就绪） */
  isAvailable(): boolean {
    if (!this.enabled) return false;
    for (const client of this.clients.values()) {
      if (client.isReady()) return true;
    }
    return false;
  }

  /** 设置启用状态 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      void this.stop();
    }
  }

  // ==================== 启动 / 停止 ====================

  /** 初始化事件监听（仅一次） */
  private async initListeners(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const unlistenMsg = await onLspMessage(({ serverId, message }) => {
      // 路由到对应 client
      for (const client of this.clients.values()) {
        if (client.serverId === serverId) {
          client.handleMessage(message);
          return;
        }
      }
    });

    const unlistenExit = await onLspExit(({ serverType }) => {
      const client = this.clients.get(serverType);
      if (client) {
        this.clients.delete(serverType);
      }
      // 如果全部退出，标记为不可用
      if (this.clients.size === 0 && this.enabled) {
        this._status = "unavailable";
      }
    });

    this.unlistenFns.push(unlistenMsg, unlistenExit);
  }

  /** 启动工作区的 language server */
  async start(root: string): Promise<void> {
    if (!this.enabled) {
      this._status = "disabled";
      return;
    }

    // 工作区切换时先停掉旧的
    if (this.root && this.root !== root) {
      await this.stop();
    }

    this.root = root;
    this._status = "checking";

    // 检测运行时
    const runtime = await detectRuntime();
    if (!runtime.node) {
      this._status = "unavailable";
      return;
    }

    await this.initListeners();

    this._status = "starting";

    // 启动 TS server（如果可用）
    if (runtime.tsLs && !this.clients.has("ts")) {
      try {
        const serverId = await startServer("ts", root);
        const client = new LanguageClient(serverId, "ts", root);
        // 订阅诊断通知
        client.onNotification((method, params) => {
          if (method === "textDocument/publishDiagnostics") {
            this.handleDiagnostics(params);
          }
        });
        await client.initialize();
        this.clients.set("ts", client);
      } catch (err) {
        console.error("[lsp] 启动 TS server 失败:", err);
      }
    }

    // 启动 Vue server（如果可用）
    if (runtime.volar && !this.clients.has("vue")) {
      try {
        const serverId = await startServer("vue", root);
        const client = new LanguageClient(serverId, "vue", root);
        client.onNotification((method, params) => {
          if (method === "textDocument/publishDiagnostics") {
            this.handleDiagnostics(params);
          }
        });
        await client.initialize();
        this.clients.set("vue", client);
      } catch (err) {
        console.error("[lsp] 启动 Vue server 失败:", err);
      }
    }

    if (this.clients.size > 0) {
      this._status = "ready";
    } else {
      this._status = "unavailable";
    }
  }

  /** 停止全部 server */
  async stop(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.shutdown();
      } catch {
        // 忽略
      }
    }
    this.clients.clear();
    await stopAllServers();
    this._status = this.enabled ? "disabled" : "disabled";
  }

  /** 销毁（取消事件监听） */
  async destroy(): Promise<void> {
    await this.stop();
    for (const unlisten of this.unlistenFns) {
      try {
        unlisten();
      } catch {
        // 忽略
      }
    }
    this.unlistenFns = [];
    this.initialized = false;
  }

  // ==================== 文件类型路由 ====================

  /** 根据文件路径获取对应的 client */
  getClientForFile(filePath: string): LanguageClient | null {
    const ext = filePath.split(".").pop()?.toLowerCase();
    if (ext === "vue") {
      // Vue 文件优先用 volar，没有则降级到 ts（tsx 投影模式）
      return this.clients.get("vue") ?? this.clients.get("ts") ?? null;
    }
    if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext ?? "")) {
      return this.clients.get("ts") ?? null;
    }
    return null;
  }

  // ==================== 文档同步 ====================

  async didOpen(filePath: string, text: string): Promise<void> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady()) return;
    const uri = pathToUri(filePath);
    const languageId = getLanguageId(filePath);
    await client.didOpen(uri, languageId, text);
  }

  async didChange(
    filePath: string,
    changes: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }>,
    newText: string,
  ): Promise<void> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady()) return;
    const uri = pathToUri(filePath);
    await client.didChange(uri, changes, newText);
  }

  async didClose(filePath: string): Promise<void> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady()) return;
    const uri = pathToUri(filePath);
    await client.didClose(uri);
  }

  async didSave(filePath: string, text: string): Promise<void> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady()) return;
    const uri = pathToUri(filePath);
    await client.didSave(uri, text);
  }

  // ==================== LSP 能力请求 ====================

  /** hover */
  async hover(
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady() || !client.supportsHover()) return null;
    const uri = pathToUri(filePath);
    return client.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  /** 补全 */
  async completion(
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady() || !client.supportsCompletion()) return null;
    const uri = pathToUri(filePath);
    return client.request("textDocument/completion", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  /** 签名帮助 */
  async signatureHelp(
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady() || !client.supportsSignatureHelp()) return null;
    const uri = pathToUri(filePath);
    return client.request("textDocument/signatureHelp", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  /** 定义跳转 */
  async definition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady() || !client.supportsDefinition()) return null;
    const uri = pathToUri(filePath);
    return client.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  /** 引用查找 */
  async references(
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady() || !client.supportsReferences()) return null;
    const uri = pathToUri(filePath);
    return client.request("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  /** 准备重命名（获取符号范围） */
  async prepareRename(
    filePath: string,
    line: number,
    character: number,
  ): Promise<unknown | null> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady() || !client.supportsRename()) return null;
    const uri = pathToUri(filePath);
    return client.request("textDocument/prepareRename", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  /** 重命名 */
  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<unknown | null> {
    const client = this.getClientForFile(filePath);
    if (!client?.isReady() || !client.supportsRename()) return null;
    const uri = pathToUri(filePath);
    return client.request("textDocument/rename", {
      textDocument: { uri },
      position: { line, character },
      newName,
    });
  }

  // ==================== 诊断 ====================

  /** 订阅诊断通知 */
  onDiagnostics(handler: DiagnosticsHandler): void {
    this.diagnosticsHandlers.push(handler);
  }

  /** 处理 publishDiagnostics 通知 */
  private handleDiagnostics(params: unknown): void {
    const p = params as {
      uri?: string;
      diagnostics?: Array<{
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        severity?: number;
        message?: string;
        source?: string;
      }>;
    };
    if (!p?.uri || !p.diagnostics) return;
    const path = uriToPath(p.uri);
    for (const handler of this.diagnosticsHandlers) {
      handler(path, p.diagnostics);
    }
  }
}

/** 全局单例 */
export const lspManager = new LspManagerImpl();
