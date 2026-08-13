/**
 * LanguageClient：单个 language server 的生命周期管理
 *
 * 职责：
 * - initialize 协商（发 initialize -> 收 capabilities -> 发 initialized）
 * - 文档同步（didOpen / didChange / didClose / didSave）
 * - 请求/响应路由（request id -> pending Promise）
 * - 通知分发（publishDiagnostics 等推给订阅者）
 */

import type { ServerCapabilities } from "vscode-languageserver-protocol";
import {
  allocRequestId,
  sendNotification,
  sendRequest,
} from "./transport";
import type { ServerType } from "./types";

// ==================== 常量 ====================

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 10000;

// ==================== 类型 ====================

/** 文档同步模式 */
export type TextDocumentSyncKind = 0 | 1 | 2; // none | full | incremental

/** 打开的文档信息 */
interface OpenDocument {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

/** 通知订阅回调 */
type NotificationHandler = (method: string, params: unknown) => void;

// ==================== LanguageClient ====================

export class LanguageClient {
  /** server 标识 */
  readonly serverId: number;
  /** server 类型 */
  readonly serverType: ServerType;
  /** 工作区根 */
  readonly root: string;
  /** server capabilities（initialize 后填充） */
  capabilities: ServerCapabilities | null = null;

  /** 是否已初始化 */
  private initialized = false;
  /** 打开的文档（uri -> OpenDocument） */
  private openDocuments = new Map<string, OpenDocument>();
  /** 待响应的请求（id -> {resolve, reject, timer}） */
  private pendingRequests = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** 通知订阅者 */
  private notificationHandlers: NotificationHandler[] = [];
  /** 文档同步模式 */
  private syncKind: TextDocumentSyncKind = 2; // 默认增量

  constructor(serverId: number, serverType: ServerType, root: string) {
    this.serverId = serverId;
    this.serverType = serverType;
    this.root = root;
  }

  /** 是否已就绪 */
  isReady(): boolean {
    return this.initialized && this.capabilities !== null;
  }

  // ==================== 生命周期 ====================

  /** 发送 initialize 请求并协商 capabilities */
  async initialize(): Promise<ServerCapabilities | null> {
    const rootUri = pathToUri(this.root);
    const params = {
      processId: null,
      clientInfo: {
        name: "Miro Code",
        version: "0.9.0",
      },
      rootUri,
      capabilities: {
        workspace: {
          workspaceEdit: { documentChanges: true },
          applyEdit: true,
          configuration: true,
        },
        textDocument: {
          synchronization: { didSave: true, willSave: false, willSaveWaitUntil: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"] } },
          publishDiagnostics: { relatedInformation: true },
          definition: { linkSupport: false },
          references: {},
          rename: { prepareSupport: true },
        },
      },
      workspaceFolders: [{ uri: rootUri, name: basename(this.root) }],
    };

    const result = await this.request("initialize", params);
    this.capabilities = (result as { capabilities?: ServerCapabilities }).capabilities ?? null;

    // 解析文档同步模式
    const syncKind = this.capabilities?.textDocumentSync;
    if (typeof syncKind === "number") {
      this.syncKind = syncKind as TextDocumentSyncKind;
    } else if (syncKind && typeof syncKind === "object") {
      this.syncKind = ((syncKind as { change?: number }).change ?? 2) as TextDocumentSyncKind;
    }

    // 发送 initialized 通知
    await sendNotification(this.serverId, "initialized", {});

    this.initialized = true;
    return this.capabilities;
  }

  /** 关闭 server */
  async shutdown(): Promise<void> {
    // 关闭所有打开的文档
    for (const uri of this.openDocuments.keys()) {
      await sendNotification(this.serverId, "textDocument/didClose", {
        textDocument: { uri },
      });
    }
    this.openDocuments.clear();

    // 取消所有待响应请求
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error("server shutting down"));
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
    }

    this.initialized = false;
  }

  // ==================== 文档同步 ====================

  /** 打开文档 */
  async didOpen(
    uri: string,
    languageId: string,
    text: string,
  ): Promise<void> {
    if (!this.isReady()) return;

    const version = Date.now();
    this.openDocuments.set(uri, { uri, languageId, version, text });

    await sendNotification(this.serverId, "textDocument/didOpen", {
      textDocument: { uri, languageId, version, text },
    });
  }

  /** 文档变更（增量同步；changes 为空时自动降级为全量替换） */
  async didChange(
    uri: string,
    changes: Array<{ range?: { start: Position; end: Position } | null; text: string }>,
    newText: string,
  ): Promise<void> {
    if (!this.isReady()) return;

    const doc = this.openDocuments.get(uri);
    if (!doc) {
      // 未打开，重新 didOpen
      await this.didOpen(uri, guessLanguageId(uri), newText);
      return;
    }

    const version = doc.version + 1;
    doc.version = version;
    doc.text = newText;

    if (this.syncKind === 1) {
      // 全量同步
      await sendNotification(this.serverId, "textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text: newText }],
      });
    } else {
      // 增量同步；changes 为空时降级为全量替换（LSP 规范 range: null = 全量），
      // 避免空数组被 server 解读为「无变更」导致 server 端文档永不更新
      const contentChanges =
        changes.length > 0 ? changes : [{ range: null, text: newText }];
      await sendNotification(this.serverId, "textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges,
      });
    }
  }

  /** 关闭文档 */
  async didClose(uri: string): Promise<void> {
    if (!this.isReady()) return;

    this.openDocuments.delete(uri);
    await sendNotification(this.serverId, "textDocument/didClose", {
      textDocument: { uri },
    });
  }

  /** 保存文档 */
  async didSave(uri: string, text: string): Promise<void> {
    if (!this.isReady()) return;

    const sendText = this.capabilities?.textDocumentSync &&
      typeof this.capabilities.textDocumentSync === "object" &&
      (this.capabilities.textDocumentSync as { save?: { includeText?: boolean } }).save?.includeText;

    await sendNotification(this.serverId, "textDocument/didSave", {
      textDocument: { uri },
      ...(sendText ? { text } : {}),
    });
  }

  // ==================== 请求 ====================

  /** 发送请求并等待响应（带超时） */
  request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = allocRequestId();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP 请求超时（${REQUEST_TIMEOUT_MS}ms）：${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timer });

      sendRequest(this.serverId, id, method, params).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`发送 LSP 请求失败：${err}`));
      });
    });
  }

  /** 发送通知（无响应） */
  notify(method: string, params?: unknown): Promise<void> {
    return sendNotification(this.serverId, method, params);
  }

  // ==================== 消息分发 ====================

  /** 处理从 transport 收到的消息 */
  handleMessage(message: unknown): void {
    const msg = message as {
      jsonrpc?: string;
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: unknown;
    };

    // 响应（有 id 无 method）
    if (msg.id !== undefined && msg.method === undefined) {
      const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
      const pending = this.pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        if (msg.error) {
          pending.reject(new Error(`LSP 错误：${JSON.stringify(msg.error)}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 通知或反向请求（有 method）
    if (msg.method) {
      // 分发给订阅者
      for (const handler of this.notificationHandlers) {
        handler(msg.method, msg.params);
      }

      // 反向请求（有 id）：暂时返回空 result（不支持 workspace/applyEdit 等）
      if (msg.id !== undefined) {
        // 通过 transport 的 sendResponse 回复
        // 但这里没有直接引用 sendResponse，由上层 manager 处理
      }
    }
  }

  /** 订阅通知 */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.push(handler);
  }

  // ==================== 能力查询 ====================

  supportsCompletion(): boolean {
    return !!this.capabilities?.completionProvider;
  }

  supportsHover(): boolean {
    return !!this.capabilities?.hoverProvider;
  }

  supportsSignatureHelp(): boolean {
    return !!this.capabilities?.signatureHelpProvider;
  }

  supportsDefinition(): boolean {
    return !!this.capabilities?.definitionProvider;
  }

  supportsReferences(): boolean {
    return !!this.capabilities?.referencesProvider;
  }

  supportsRename(): boolean {
    return !!this.capabilities?.renameProvider;
  }

  supportsDiagnostics(): boolean {
    // publishDiagnostics 是 server 主动推送的，不需要专门的 provider
    return true;
  }
}

// ==================== 辅助函数 ====================

/** 文件路径转 file:// URI */
export function pathToUri(path: string): string {
  // 规范化：确保绝对路径
  const normalized = path.replace(/\\/g, "/");
  // macOS/Linux: /开头；Windows: C:\ 开头
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  // Windows: file:///C:/...
  return `file:///${normalized}`;
}

/** file:// URI 转文件路径 */
export function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    let path = uri.slice(7);
    // Windows: /C:/... -> C:\...
    if (/^\/[A-Zaza]:/.test(path)) {
      path = path.slice(1).replace(/\//g, "\\");
    }
    return path;
  }
  return uri;
}

/** 取 basename */
function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

/** LSP Position */
interface Position {
  line: number;
  character: number;
}

/** 根据文件扩展名猜测 languageId */
function guessLanguageId(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    case "vue":
      return "vue";
    case "json":
      return "json";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "less":
      return "less";
    case "html":
      return "html";
    case "md":
      return "markdown";
    default:
      return "plaintext";
  }
}

/** 根据文件路径获取 languageId */
export function getLanguageId(filePath: string): string {
  return guessLanguageId(filePath);
}
