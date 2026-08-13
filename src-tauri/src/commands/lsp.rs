//! LSP（Language Server Protocol）传输层
//!
//! 职责：管理 language server 子进程（typescript-language-server / @vue/language-server），
//! 通过 stdio 双向传输 JSON-RPC 消息（Content-Length 分帧）。
//!
//! 不自研 LSP 服务端，仅作 transport 桥接：
//! - 前端通过 invoke 发送请求/通知 -> 本模块分帧写入子进程 stdin
//! - 子进程 stdout 读取循环 -> 本模块通过 Tauri event 推送前端
//!
//! 架构约束（见 docs/Miro Code技术架构文档.md §3.3）：
//! 不自研完整语言服务器协议实现，二期接入官方/社区 LSP。

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use super::language_services::bundled_runtime;

// ==================== 常量 ====================

/// LSP 消息推送到前端的事件名
const LSP_EVENT_MESSAGE: &str = "lsp://message";
/// 子进程退出事件名
const LSP_EVENT_EXIT: &str = "lsp://exit";
/// 子进程 stderr 日志事件名（调试用）
const LSP_EVENT_STDERR: &str = "lsp://stderr";

// ==================== 类型 ====================

/// language server 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerType {
    /// typescript-language-server（TS/JS/JSX/TSX）
    Ts,
    /// @vue/language-server（Volar，Vue SFC）
    Vue,
}

impl ServerType {
    /// npx 包名（回退宿主环境时用）
    fn package_name(&self) -> &'static str {
        match self {
            ServerType::Ts => "typescript-language-server",
            ServerType::Vue => "vue-language-server",
        }
    }

    /// 语言标识（与 language_services.rs 的 language 参数、打包脚本 --language 对齐）
    pub fn as_str(&self) -> &'static str {
        match self {
            ServerType::Ts => "ts",
            ServerType::Vue => "vue",
        }
    }
}

/// 运行时检测结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCheck {
    pub node: bool,
    pub ts_ls: bool,
    pub volar: bool,
    /// 内置语言服务捆绑包版本（非空表示 LSP 由内置 Node + server 驱动，不再依赖宿主环境）
    pub bundled_version: Option<String>,
}

/// 单个 LSP server 的运行态
struct LspServerState {
    /// 子进程句柄（stop 时用）
    child: Option<Child>,
    /// stdin 写入端（发送消息用）
    stdin: Option<ChildStdin>,
    /// server 唯一标识
    server_id: u64,
    /// server 类型
    server_type: ServerType,
    /// 工作区根
    root: String,
}

/// 全局 LSP 管理器（tauri::State 托管）
#[derive(Default, Clone)]
pub struct LspManager {
    /// server_id -> 运行态（Arc 共享，clone 时共享底层 Mutex）
    servers: Arc<Mutex<HashMap<u64, LspServerState>>>,
    /// id 生成器（Arc 共享）
    next_id: Arc<AtomicU64>,
}

impl LspManager {
    fn alloc_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }
}

// ==================== 子进程启动 ====================

/// 构造 npx 命令（跨平台，复用 tooling.rs 模式）
fn npx_command() -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg("npx");
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("npx")
    }
}

/// 构造 language server 启动命令
///
/// 启动策略（优先级）：
/// 1. 已安装的语言服务捆绑包（设置内按语言安装）：直接用捆绑的 Node 执行 server 入口，
///    不依赖宿主 PATH 上的 Node/npx
/// 2. 回退：宿主 npx --no-install（项目/全局 node_modules）
fn build_server_command(
    rt: Option<&crate::commands::language_services::BundledRuntime>,
    server_type: ServerType,
    root: &str,
) -> std::process::Command {
    let mut cmd = if let Some(rt) = rt {
        // 路径 1：已安装 bundle -- 用捆绑的 node 直接执行 server 入口 JS
        let mut c = std::process::Command::new(&rt.node_path);
        c.arg(&rt.entry);
        c
    } else {
        // 路径 2：回退宿主 npx --no-install <包名>
        let mut c = npx_command();
        c.args(["--no-install", server_type.package_name()]);
        c
    };
    cmd.args(["--stdio"]).current_dir(root);
    cmd
}

/// 用 tokio::process::Command 启动 language server 子进程
///
/// 返回 (Child, stdin, stdout)；stderr 读循环在此函数内启动
async fn spawn_server(
    app: AppHandle,
    server_type: ServerType,
    root: String,
) -> Result<(Child, ChildStdin, ChildStdout), String> {
    let rt = bundled_runtime(&app, server_type.as_str());
    let mut cmd = build_server_command(rt.as_ref(), server_type, &root);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = tokio::process::Command::from(cmd)
        .spawn()
        .map_err(|e| {
            format!(
                "无法启动 {}（请确认已安装 Node 与对应 language server）: {e}",
                server_type.package_name()
            )
        })?;

    let stdin = child.stdin.take().ok_or("无法获取子进程 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取子进程 stdout")?;
    let stderr = child.stderr.take();

    // stderr 读循环（推到前端做调试）
    if let Some(stderr) = stderr {
        let package = server_type.package_name().to_string();
        let app_clone = app.clone();
        tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stderr);
            let mut buf = String::new();
            loop {
                buf.clear();
                match reader.read_line(&mut buf).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = buf.trim_end();
                        if !line.is_empty() {
                            eprintln!("[lsp:{package} stderr] {line}");
                            let _ = app_clone.emit(LSP_EVENT_STDERR, line);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok((child, stdin, stdout))
}

// ==================== Content-Length 分帧 ====================

/// 从 reader 读取一条完整的 LSP 消息（Content-Length 分帧）
///
/// 格式：
/// ```text
/// Content-Length: 1234\r\n
/// \r\n
/// {json body}
/// ```
///
/// 泛型版本：接受任何 AsyncBufRead + Unpin，便于测试
async fn read_lsp_message_from<R>(reader: &mut R) -> Result<Value, String>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    let mut content_length: usize = 0;

    // 1. 读 headers（每行以 \r\n 结尾，空行表示 header 结束）
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("读 header 行失败: {e}"))?;
        if n == 0 {
            return Err("stdout EOF".into());
        }
        // 去掉 \r\n
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            // 空行 = header 结束
            break;
        }
        if let Some(rest) = line.strip_prefix("Content-Length:") {
            content_length = rest.trim().parse().map_err(|e: std::num::ParseIntError| {
                format!("解析 Content-Length 失败: {e}")
            })?;
        }
        // 其他 header（Content-Type 等）忽略
    }

    if content_length == 0 {
        return Err("Content-Length 为 0".into());
    }

    // 2. 读 body
    let mut body = vec![0u8; content_length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|e| format!("读取消息体失败: {e}"))?;

    // 3. 解析 JSON
    serde_json::from_slice(&body).map_err(|e| format!("解析 JSON-RPC 消息失败: {e}"))
}

/// 从 stdout 读取一条 LSP 消息（生产用，包装泛型版本）
async fn read_lsp_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    read_lsp_message_from(reader).await
}

// ==================== 测试辅助函数（供集成测试调用） ====================

/// 测试用：从字节切片读取单条 LSP 消息
#[cfg(any(test, feature = "test"))]
pub async fn read_lsp_message_for_test(data: &[u8]) -> Result<Value, String> {
    let mut reader = tokio::io::BufReader::new(data);
    read_lsp_message_from(&mut reader).await
}

/// 测试用：从字节切片读取全部 LSP 消息（连续分帧）
#[cfg(any(test, feature = "test"))]
pub async fn read_lsp_message_for_test_all(data: &[u8]) -> Result<Vec<Value>, String> {
    let mut reader = tokio::io::BufReader::new(data);
    let mut messages = Vec::new();
    loop {
        match read_lsp_message_from(&mut reader).await {
            Ok(msg) => messages.push(msg),
            Err(_) => break,
        }
    }
    Ok(messages)
}

/// 把 JSON-RPC 消息分帧写入 stdin（Content-Length 头 + body）
///
/// 异步写，调用方需 await
async fn write_lsp_message(stdin: &mut ChildStdin, message: &Value) -> Result<(), String> {
    let body = serde_json::to_string(message).map_err(|e| e.to_string())?;
    let body_bytes = body.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", body_bytes.len());

    stdin
        .write_all(header.as_bytes())
        .await
        .map_err(|e| format!("写入 header 失败: {e}"))?;
    stdin
        .write_all(body_bytes)
        .await
        .map_err(|e| format!("写入 body 失败: {e}"))?;
    stdin.flush().await.map_err(|e| format!("flush stdin 失败: {e}"))?;
    Ok(())
}

// ==================== stdout 读取循环 ====================

/// 启动 stdout 读取循环，把消息通过 Tauri event 推给前端
fn spawn_read_loop(
    app: AppHandle,
    manager: LspManager,
    stdout: ChildStdout,
    server_id: u64,
    server_type: ServerType,
    root: String,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_lsp_message(&mut reader).await {
                Ok(message) => {
                    let payload = serde_json::json!({
                        "serverId": server_id,
                        "message": message,
                    });
                    let _ = app.emit(LSP_EVENT_MESSAGE, &payload);
                }
                Err(e) => {
                    eprintln!(
                        "[lsp:{:?} {}] 读取循环结束: {}",
                        server_type, server_id, e
                    );
                    // 异常退出（server 崩溃 / 管道关闭）：清理服务器状态。
                    // 主动 lsp_stop 已先 remove 条目，此时 remove 返回 None 不会重复清理；
                    // 未主动 stop 的僵尸 server 在这里被回收（kill + wait 防 zombie）
                    let killed = {
                        let mut servers = manager.servers.lock().await;
                        if let Some(mut server) = servers.remove(&server_id) {
                            let mut did_kill = false;
                            if let Some(mut child) = server.child.take() {
                                let _ = child.kill().await;
                                let _ = child.wait().await;
                                did_kill = true;
                            }
                            drop(server);
                            did_kill
                        } else {
                            false
                        }
                    };
                    let _ = app.emit(
                        LSP_EVENT_EXIT,
                        &serde_json::json!({
                            "serverId": server_id,
                            "serverType": server_type,
                            "root": root,
                            "killed": killed,
                        }),
                    );
                    break;
                }
            }
        }
    });
}

// ==================== 命令 ====================

/// 检测运行时：node / typescript-language-server / vue-language-server 是否可用
///
/// 按语言独立判定：每种语言优先检查对应捆绑包是否已安装，
/// 未安装则回退检测宿主 node/npx 与全局/项目包（现有降级路径）。
#[tauri::command]
pub async fn lsp_check_runtime(app: AppHandle) -> Result<RuntimeCheck, String> {
    // 按语言独立检测已安装的捆绑包
    let ts_rt = bundled_runtime(&app, "ts");
    let vue_rt = bundled_runtime(&app, "vue");

    // 如果两种语言 bundle 都已安装，直接返回（node 全部由 bundle 提供）
    if ts_rt.is_some() && vue_rt.is_some() {
        return Ok(RuntimeCheck {
            node: true,
            ts_ls: true,
            volar: true,
            bundled_version: Some(format!(
                "ts={} vue={}",
                ts_rt.as_ref().unwrap().version,
                vue_rt.as_ref().unwrap().version
            )),
        });
    }

    // 回退宿主环境检测
    let node = check_command("node --version").await && check_command("npx --version").await;

    // TS：bundle 已装则 true，否则检测宿主
    let ts_ls = if ts_rt.is_some() {
        true
    } else if node {
        check_npx_package("typescript-language-server --version").await
    } else {
        false
    };
    // Vue：bundle 已装则 true，否则检测宿主
    let volar = if vue_rt.is_some() {
        true
    } else if node {
        check_npx_package("vue-language-server --version").await
    } else {
        false
    };

    // bundled_version：任一 bundle 已装就展示版本摘要
    let bundled_version = match (&ts_rt, &vue_rt) {
        (Some(ts), Some(vue)) => Some(format!("ts={} vue={}", ts.version, vue.version)),
        (Some(ts), None) => Some(format!("ts={}", ts.version)),
        (None, Some(vue)) => Some(format!("vue={}", vue.version)),
        (None, None) => None,
    };

    Ok(RuntimeCheck {
        node,
        ts_ls,
        volar,
        bundled_version,
    })
}

/// 检测一个 shell 命令是否可执行（退出码 0 视为可用）
async fn check_command(cmd: &'static str) -> bool {
    let result = tokio::task::spawn_blocking(move || {
        run_shell_cmd(cmd)
    })
    .await;
    result.unwrap_or(false)
}

/// 检测 npx 包是否可用
async fn check_npx_package(version_cmd: &'static str) -> bool {
    let result = tokio::task::spawn_blocking(move || {
        let full_cmd = format!("npx --no-install {}", version_cmd);
        run_shell_cmd(&full_cmd)
    })
    .await;
    result.unwrap_or(false)
}

/// 在阻塞线程中执行 shell 命令，返回是否成功（退出码 0）
fn run_shell_cmd(cmd: &str) -> bool {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(cmd);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(cmd);
        c
    };
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 启动 language server，返回 server_id
#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    state: State<'_, LspManager>,
    server_type: ServerType,
    root: String,
) -> Result<u64, String> {
    let server_id = state.alloc_id();

    let (child, stdin, stdout) =
        spawn_server(app.clone(), server_type, root.clone()).await?;

    // 启动 stdout 读取循环
    spawn_read_loop(
        app,
        state.inner().clone(),
        stdout,
        server_id,
        server_type,
        root.clone(),
    );

    let server_state = LspServerState {
        child: Some(child),
        stdin: Some(stdin),
        server_id,
        server_type,
        root,
    };

    {
        let mut servers = state.servers.lock().await;
        servers.insert(server_id, server_state);
    }

    Ok(server_id)
}

/// 发送 JSON-RPC 请求（带 id）
#[tauri::command]
pub async fn lsp_send_request(
    state: State<'_, LspManager>,
    server_id: u64,
    id: u64,
    method: String,
    params: Option<Value>,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    let server = servers.get_mut(&server_id).ok_or("server 不存在")?;

    let message = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params.unwrap_or(Value::Null),
    });

    let stdin = server.stdin.as_mut().ok_or("stdin 已关闭")?;
    write_lsp_message(stdin, &message).await
}

/// 发送 JSON-RPC 通知（无 id）
#[tauri::command]
pub async fn lsp_send_notification(
    state: State<'_, LspManager>,
    server_id: u64,
    method: String,
    params: Option<Value>,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    let server = servers.get_mut(&server_id).ok_or("server 不存在")?;

    let message = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params.unwrap_or(Value::Null),
    });

    let stdin = server.stdin.as_mut().ok_or("stdin 已关闭")?;
    write_lsp_message(stdin, &message).await
}

/// 响应 server 发来的反向请求（如 workspace/applyEdit）
#[tauri::command]
pub async fn lsp_send_response(
    state: State<'_, LspManager>,
    server_id: u64,
    id: Value,
    result: Value,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    let server = servers.get_mut(&server_id).ok_or("server 不存在")?;

    let message = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    });

    let stdin = server.stdin.as_mut().ok_or("stdin 已关闭")?;
    write_lsp_message(stdin, &message).await
}

/// 停止单个 server（发 shutdown -> exit -> kill）
#[tauri::command]
pub async fn lsp_stop(state: State<'_, LspManager>, server_id: u64) -> Result<(), String> {
    let mut server = {
        let mut servers = state.servers.lock().await;
        servers.remove(&server_id).ok_or("server 不存在")?
    };

    // 优雅关闭：发 shutdown + exit
    if let Some(stdin) = server.stdin.as_mut() {
        let shutdown = serde_json::json!({
            "jsonrpc": "2.0",
            "id": format!("shutdown-{}", server_id),
            "method": "shutdown",
        });
        let _ = write_lsp_message(stdin, &shutdown).await;

        let exit = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "exit",
        });
        let _ = write_lsp_message(stdin, &exit).await;
    }

    // 等待退出 / kill
    if let Some(mut child) = server.child.take() {
        match tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                let _ = child.kill().await;
            }
        }
    }

    Ok(())
}

/// 停止全部 server（应用退出 / 工作区切换时调用）
#[tauri::command]
pub async fn lsp_stop_all(state: State<'_, LspManager>) -> Result<(), String> {
    lsp_stop_all_inner(&state.inner()).await
}

/// 内部实现（供 on_window_event 等 非 State 上下文调用）
pub async fn lsp_stop_all_inner(manager: &LspManager) -> Result<(), String> {
    let ids: Vec<u64> = {
        let servers = manager.servers.lock().await;
        servers.keys().copied().collect()
    };

    for id in ids {
        let mut server = {
            let mut servers = manager.servers.lock().await;
            servers.remove(&id)
        };

        if let Some(ref mut server) = server {
            if let Some(stdin) = server.stdin.as_mut() {
                let shutdown = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": format!("shutdown-{}", id),
                    "method": "shutdown",
                });
                let _ = write_lsp_message(stdin, &shutdown).await;

                let exit = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "exit",
                });
                let _ = write_lsp_message(stdin, &exit).await;
            }
            if let Some(mut child) = server.child.take() {
                match tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await {
                    Ok(_) => {}
                    Err(_) => {
                        let _ = child.kill().await;
                    }
                }
            }
        }
    }
    Ok(())
}

/// 获取当前活跃 server 列表（调试用）
#[tauri::command]
pub async fn lsp_list_servers(state: State<'_, LspManager>) -> Result<Vec<Value>, String> {
    let servers = state.servers.lock().await;
    let list = servers
        .values()
        .map(|s| {
            serde_json::json!({
                "serverId": s.server_id,
                "serverType": s.server_type,
                "root": s.root,
            })
        })
        .collect();
    Ok(list)
}

// ==================== 测试 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_jsonrpc_request_structure() {
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "rootUri": "file:///test" },
        });
        assert_eq!(msg["jsonrpc"], "2.0");
        assert_eq!(msg["id"], 1);
        assert_eq!(msg["method"], "initialize");
        assert_eq!(msg["params"]["rootUri"], "file:///test");
    }

    #[test]
    fn test_jsonrpc_notification_no_id() {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": { "textDocument": { "uri": "file:///test.ts" } },
        });
        assert!(msg.get("id").is_none());
        assert_eq!(msg["method"], "textDocument/didOpen");
    }

    #[test]
    fn test_message_serialization() {
        let msg = json!({
            "jsonrpc": "2.0",
            "id": 42,
            "method": "textDocument/hover",
            "params": {},
        });
        let body = serde_json::to_string(&msg).unwrap();
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        assert!(header.starts_with("Content-Length: "));
        assert!(header.contains("\r\n\r\n"));
        assert!(body.contains("textDocument/hover"));
    }

    #[test]
    fn test_server_type_serialize() {
        assert_eq!(serde_json::to_string(&ServerType::Ts).unwrap(), "\"ts\"");
        assert_eq!(serde_json::to_string(&ServerType::Vue).unwrap(), "\"vue\"");
    }

    #[test]
    fn test_manager_id_allocation() {
        let manager = LspManager::default();
        let id1 = manager.alloc_id();
        let id2 = manager.alloc_id();
        assert_eq!(id2, id1 + 1);
    }

    #[test]
    fn test_build_command_npx_fallback() {
        // 无内置捆绑包：回退宿主 npx --no-install <包名> --stdio
        let cmd = build_server_command(None, ServerType::Ts, "/tmp/ws");
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(cmd.get_program(), "npx");
        }
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"--no-install".to_string()));
        assert!(args.contains(&"typescript-language-server".to_string()));
        assert!(args.contains(&"--stdio".to_string()));
    }

    #[test]
    fn test_build_command_uses_bundle() {
        // 已安装捆绑包：直接用捆绑 Node 执行 server 入口
        let rt = super::super::language_services::BundledRuntime {
            version: "0.1.0".into(),
            node_path: "/bundle/node/bin/node".into(),
            entry: "/bundle/node_modules/@vue/language-server/bin/vue-language-server.js"
                .into(),
        };
        let cmd = build_server_command(Some(&rt), ServerType::Vue, "/ws");
        assert_eq!(cmd.get_program(), "/bundle/node/bin/node");
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            args,
            vec![
                "/bundle/node_modules/@vue/language-server/bin/vue-language-server.js".to_string(),
                "--stdio".to_string(),
            ]
        );
    }

    /// 端到端：用系统真实 node 模拟「捆绑包 node」，走完整启动链路
    /// （命令构造 -> tokio spawn -> stdio 双向），验证捆绑包产物能真实驱动子进程。
    /// 系统无 node 时跳过（CI 均自带 node）。
    #[tokio::test]
    async fn test_bundle_spawns_node_end_to_end() {
        use std::path::PathBuf;

        // 探测系统 node 绝对路径（捆绑包内的 node 与其等价）
        let Ok(probe) = std::process::Command::new("node")
            .arg("-p")
            .arg("process.execPath")
            .output()
        else {
            return;
        };
        if !probe.status.success() {
            return;
        }
        let node_path = PathBuf::from(String::from_utf8_lossy(&probe.stdout).trim().to_string());
        if !node_path.exists() {
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let fake_server = dir.path().join("server.js");
        std::fs::write(&fake_server, "process.stdout.write('BUNDLE-OK\\n');").unwrap();

        let rt = super::super::language_services::BundledRuntime {
            version: "0.1.0".into(),
            node_path,
            entry: fake_server.clone(),
        };

        let mut cmd = build_server_command(
            Some(&rt),
            ServerType::Ts,
            dir.path().to_str().unwrap(),
        );
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = tokio::process::Command::from(cmd)
            .spawn()
            .expect("捆绑包 node 应能启动子进程");
        let stdout = child.stdout.take().expect("应能拿到 stdout");
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .expect("应能从捆绑包子进程读到输出");
        assert_eq!(line.trim(), "BUNDLE-OK");
        let _ = child.kill().await;
    }
}
