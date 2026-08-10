//! AI 行内智能补全后端
//!
//! 职责：
//! 1. 凭据存储：API Key 持久化到 ~/.mirocode/ai-credentials.json（0600），复刻 SSH 凭据模式
//! 2. 流式补全：用 reqwest 向 AI 服务发起 FIM/completions 请求，tokio 读 SSE 流，
//!    逐 chunk 通过 Tauri event 推送前端（复刻 LSP spawn_read_loop 模式）
//!
//! 架构约束：不自研模型，仅作 HTTP transport 桥接。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::task::AbortHandle;

// ==================== 在途请求取消 ====================

/// 在途流式任务的 req_id -> AbortHandle 映射（ai_cancel 取出并 abort）
static AI_ABORT_MAP: OnceLock<Mutex<HashMap<String, AbortHandle>>> = OnceLock::new();

fn ai_abort_map() -> &'static Mutex<HashMap<String, AbortHandle>> {
    AI_ABORT_MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 注册在途任务（返回该任务的 AbortHandle）
fn register_inflight(req_id: String, handle: AbortHandle) {
    if let Ok(mut map) = ai_abort_map().lock() {
        map.insert(req_id, handle);
    }
}

/// 取消在途请求（请求已发出后仍可中途终止读取循环）
#[tauri::command]
pub fn ai_cancel(req_id: String) -> CmdResult<()> {
    if let Ok(mut map) = ai_abort_map().lock() {
        if let Some(handle) = map.remove(&req_id) {
            handle.abort();
        }
    }
    Ok(())
}

// ==================== 路径与凭据存储 ====================

/// ~/.mirocode 目录
fn miro_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".mirocode"))
}

/// AI 凭据存储路径：~/.mirocode/ai-credentials.json
fn ai_cred_store_path() -> Option<PathBuf> {
    Some(miro_dir()?.join("ai-credentials.json"))
}

/// 设置文件权限 0600（仅所有者可读写）
fn set_file_private(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
}

static AI_CRED_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn ai_cred_lock() -> &'static Mutex<()> {
    AI_CRED_LOCK.get_or_init(|| Mutex::new(()))
}

/// 凭据文件结构：provider_id -> { api_key }
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AiCredentialStored {
    api_key: String,
}

type CmdResult<T> = Result<T, String>;

fn load_cred_map(path: &std::path::Path) -> CmdResult<HashMap<String, AiCredentialStored>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_cred_map(path: &std::path::Path, map: &HashMap<String, AiCredentialStored>) -> CmdResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    set_file_private(path);
    Ok(())
}

#[tauri::command]
pub fn ai_secret_get(provider: String) -> CmdResult<Option<String>> {
    let path = ai_cred_store_path().ok_or_else(|| "无法定位凭据目录".to_string())?;
    let _guard = ai_cred_lock().lock().map_err(|e| e.to_string())?;
    let map = load_cred_map(&path)?;
    Ok(map.get(&provider).map(|c| c.api_key.clone()))
}

#[tauri::command]
pub fn ai_secret_set(provider: String, api_key: String) -> CmdResult<()> {
    let path = ai_cred_store_path().ok_or_else(|| "无法定位凭据目录".to_string())?;
    let _guard = ai_cred_lock().lock().map_err(|e| e.to_string())?;
    let mut map = load_cred_map(&path)?;
    if api_key.is_empty() {
        map.remove(&provider);
    } else {
        map.insert(provider, AiCredentialStored { api_key });
    }
    save_cred_map(&path, &map)
}

#[tauri::command]
pub fn ai_secret_remove(provider: String) -> CmdResult<()> {
    let path = ai_cred_store_path().ok_or_else(|| "无法定位凭据目录".to_string())?;
    let _guard = ai_cred_lock().lock().map_err(|e| e.to_string())?;
    let mut map = load_cred_map(&path)?;
    if map.remove(&provider).is_none() {
        return Ok(());
    }
    save_cred_map(&path, &map)
}

// ==================== 流式补全请求 ====================

/// chat 消息（用于 chat 模式）
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// DashScope partial 模式标记（前缀续写）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial: Option<bool>,
}

/// 前端发起的补全请求参数
#[derive(Debug, Deserialize)]
pub struct AiCompleteRequest {
    /// 唯一请求 id，用于事件路由（前端生成 UUID）
    pub req_id: String,
    /// API 基地址（如 https://api.deepseek.com/beta）
    pub api_base: String,
    /// API Key（由前端从凭据存储取出传入）
    pub api_key: String,
    /// 模型名
    pub model: String,
    /// 请求模式："fim" 走 /completions，"chat" 走 /chat/completions
    pub mode: String,
    /// FIM 模式的 prompt 字段（光标前文本）
    #[serde(default)]
    pub prompt: String,
    /// FIM 模式的 suffix 字段（光标后文本）
    #[serde(default)]
    pub suffix: String,
    /// chat 模式的 messages（与 prompt/suffix 互斥）
    #[serde(default)]
    pub messages: Option<Vec<ChatMessage>>,
    /// 生成 max_tokens
    pub max_tokens: u32,
    /// 温度
    pub temperature: f32,
    /// stop tokens
    pub stop: Vec<String>,
}

/// 构造请求体
///
/// FIM 模式：走 /completions 端点，prompt=prefix, suffix=suffix（API 服务器内部处理 FIM token）
/// chat 模式：走 /chat/completions 端点，用 messages 数组（支持 qwen-partial / hole-filler）
fn build_request_body(req: &AiCompleteRequest) -> CmdResult<Value> {
    if req.mode == "chat" {
        // chat 模式：/chat/completions 端点
        let messages = req.messages.as_ref().ok_or_else(|| {
            "chat 模式需要 messages 参数".to_string()
        })?;
        let messages_json: Vec<Value> = messages
            .iter()
            .map(|m| {
                let mut obj = json!({
                    "role": m.role,
                    "content": m.content,
                });
                if let Some(partial) = m.partial {
                    obj["partial"] = json!(partial);
                }
                obj
            })
            .collect();
        let mut body = json!({
            "model": req.model,
            "messages": messages_json,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
            "stream": true,
        });
        if !req.stop.is_empty() {
            body["stop"] = json!(req.stop);
        }
        Ok(body)
    } else {
        // FIM 模式：/completions 端点，prompt + suffix
        let mut body = json!({
            "model": req.model,
            "prompt": req.prompt,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
            "stream": true,
        });
        if !req.suffix.is_empty() {
            body["suffix"] = json!(req.suffix);
        }
        if !req.stop.is_empty() {
            body["stop"] = json!(req.stop);
        }
        Ok(body)
    }
}

/// 从 SSE data 行解析 delta 文本
///
/// OpenAI 兼容流式格式：data: {"choices":[{"text":"..."}]}\n\n
/// 或 delta 格式：data: {"choices":[{"delta":{"content":"..."}}]}\n\n
/// 结束标记：data: [DONE]
fn extract_delta_text(data: &str) -> Option<String> {
    let trimmed = data.trim();
    if trimmed == "[DONE]" {
        return None;
    }
    let parsed: Value = serde_json::from_str(trimmed).ok()?;
    let choices = parsed.get("choices")?.as_array()?;
    let choice = choices.first()?;
    // 优先 delta.content（新版 API），回退 text（旧版 completions）
    if let Some(content) = choice
        .get("delta")
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
    {
        return Some(content.to_string());
    }
    if let Some(text) = choice.get("text").and_then(|t| t.as_str()) {
        return Some(text.to_string());
    }
    None
}

/// 事件名：增量文本
fn delta_event(req_id: &str) -> String {
    format!("ai://delta/{req_id}")
}

/// 事件名：完成
fn done_event(req_id: &str) -> String {
    format!("ai://done/{req_id}")
}

/// 事件名：错误
fn error_event(req_id: &str) -> String {
    format!("ai://error/{req_id}")
}

/// 流式补全命令
///
/// 前端 invoke 后立即返回，流式结果通过 Tauri event 推送：
/// - ai://delta/{req_id}  增量文本
/// - ai://done/{req_id}   生成完成
/// - ai://error/{req_id}  错误信息
#[tauri::command]
pub async fn ai_complete_stream(app: AppHandle, req: AiCompleteRequest) -> CmdResult<()> {
    let req_id = req.req_id.clone();
    let body = build_request_body(&req)?;

    // 根据 mode 选择端点：fim -> /completions，chat -> /chat/completions
    let endpoint = if req.mode == "chat" {
        "/chat/completions"
    } else {
        "/completions"
    };
    let url = format!("{}{}", req.api_base.trim_end_matches('/'), endpoint);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = client
        .post(&url)
        .bearer_auth(&req.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 {status}: {text}"));
    }

    // tokio task 读 SSE 流，逐 chunk emit
    // 结束时（正常 / 错误 / abort）从在途映射移除自己
    let cleanup_id = req_id.clone();
    let inflight_id = req_id.clone();
    let task = tokio::spawn(async move {
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let delta_evt = delta_event(&req_id);
        let done_evt = done_event(&req_id);
        let error_evt = error_event(&req_id);
        let cleanup = |req_id: &str| {
            if let Ok(mut map) = ai_abort_map().lock() {
                map.remove(req_id);
            }
        };

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    buffer.push_str(&String::from_utf8_lossy(&chunk));
                    // SSE 以 \n\n 分隔事件，逐行处理
                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer = buffer[pos + 1..].to_string();

                        // 只处理 data: 开头的行
                        if let Some(data) = line.strip_prefix("data: ") {
                            match extract_delta_text(data) {
                                Some(text) if !text.is_empty() => {
                                    let _ = app.emit(&delta_evt, text);
                                }
                                _ => {
                                    // [DONE] 或无可提取文本
                                    if data.trim() == "[DONE]" {
                                        let _ = app.emit(&done_evt, ());
                                        cleanup(&cleanup_id);
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = app.emit(&error_evt, format!("流读取错误: {e}"));
                    cleanup(&cleanup_id);
                    return;
                }
            }
        }

        // 流正常结束（未收到 [DONE]）
        let _ = app.emit(&done_evt, ());
        cleanup(&cleanup_id);
    });
    // 注册在途任务，供 ai_cancel 取消
    register_inflight(inflight_id, task.abort_handle());

    Ok(())
}
