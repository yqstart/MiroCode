//! LSP transport 层集成测试
//!
//! 测试 Content-Length 分帧器的正确性：
//! 模拟 language server 的 stdout 输出（Content-Length 头 + JSON body），
//! 验证 read_lsp_message 能正确解析。

use mirocode_lib::commands::lsp::{read_lsp_message_for_test, read_lsp_message_for_test_all};
use serde_json::json;

/// 测试：单条 LSP 消息分帧解析
///
/// 构造一条完整的 LSP 消息（Content-Length 头 + JSON body），
/// 验证 read_lsp_message 能正确解析出 JSON。
#[tokio::test]
async fn test_frame_single_message() {
    let body = serde_json::to_string(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": { "rootUri": "file:///test" },
    }))
    .unwrap();

    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let raw = format!("{header}{body}");

    let parsed = read_lsp_message_for_test(raw.as_bytes()).await.unwrap();
    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 1);
    assert_eq!(parsed["method"], "initialize");
    assert_eq!(parsed["params"]["rootUri"], "file:///test");
}

/// 测试：多条连续消息分帧
#[tokio::test]
async fn test_frame_multiple_messages() {
    let msg1 = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" });
    let msg2 = json!({ "jsonrpc": "2.0", "method": "initialized" });
    let msg3 = json!({ "jsonrpc": "2.0", "id": 2, "method": "textDocument/hover" });

    let body1 = serde_json::to_string(&msg1).unwrap();
    let body2 = serde_json::to_string(&msg2).unwrap();
    let body3 = serde_json::to_string(&msg3).unwrap();

    let raw = format!(
        "Content-Length: {}\r\n\r\n{}Content-Length: {}\r\n\r\n{}Content-Length: {}\r\n\r\n{}",
        body1.len(),
        body1,
        body2.len(),
        body2,
        body3.len(),
        body3,
    );

    let messages = read_lsp_message_for_test_all(raw.as_bytes()).await.unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0]["method"], "initialize");
    assert_eq!(messages[1]["method"], "initialized");
    assert_eq!(messages[2]["method"], "textDocument/hover");
}

/// 测试：带 Content-Type 头的消息（应忽略非 Content-Length 头）
#[tokio::test]
async fn test_frame_with_content_type() {
    let body = serde_json::to_string(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "shutdown",
    }))
    .unwrap();

    let raw = format!(
        "Content-Length: {}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}",
        body.len(),
        body,
    );

    let parsed = read_lsp_message_for_test(raw.as_bytes()).await.unwrap();
    assert_eq!(parsed["method"], "shutdown");
}

/// 测试：空 body 应报错
#[tokio::test]
async fn test_frame_empty_body_error() {
    let raw = "Content-Length: 0\r\n\r\n";
    let result = read_lsp_message_for_test(raw.as_bytes()).await;
    assert!(result.is_err());
}

/// 测试：缺少 Content-Length 头应报错
#[tokio::test]
async fn test_frame_missing_content_length() {
    // 只有空行，没有 Content-Length
    let raw = "\r\n";
    let result = read_lsp_message_for_test(raw.as_bytes()).await;
    assert!(result.is_err());
}
