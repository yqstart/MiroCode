//! 工作区 ESLint / Prettier：调用项目本地 npx（需已安装依赖）

use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintDiag {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub severity: String,
    pub message: String,
}

fn npx_cmd() -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("npx");
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("npx")
    }
}

/// 用项目 Prettier 格式化文件内容；失败时返回错误信息
#[tauri::command]
pub fn format_with_prettier(
    root: String,
    rel_path: String,
    content: String,
) -> Result<String, String> {
    if !Path::new(&root).is_dir() {
        return Err("工作区无效".into());
    }
    let mut child = npx_cmd()
        .args(["--no-install", "prettier", "--stdin-filepath", &rel_path])
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("无法启动 Prettier（请确认已安装 Node 与项目 prettier）: {e}")
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| format!("写入 Prettier stdin 失败: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待 Prettier 失败: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Prettier 执行失败（项目可能未安装 prettier）".into()
        } else {
            err
        });
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Prettier 输出非 UTF-8: {e}"))
}

/// 对单文件跑 ESLint，返回行列诊断（前端换算 offset）
#[tauri::command]
pub fn lint_with_eslint(root: String, rel_path: String) -> Result<Vec<EslintDiag>, String> {
    if !Path::new(&root).is_dir() {
        return Err("工作区无效".into());
    }
    let output = npx_cmd()
        .args([
            "--no-install",
            "eslint",
            "-f",
            "json",
            "--no-error-on-unmatched-pattern",
            &rel_path,
        ])
        .current_dir(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            format!("无法启动 ESLint（请确认已安装 Node 与项目 eslint）: {e}")
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !err.is_empty() {
                return Err(err);
            }
        }
        return Ok(vec![]);
    }

    let parsed: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("解析 ESLint JSON 失败: {e}"))?;

    let mut out = Vec::new();
    for file in parsed.as_array().cloned().unwrap_or_default() {
        for msg in file
            .get("messages")
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default()
        {
            let line = msg.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
            let column = msg.get("column").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
            let end_line = msg
                .get("endLine")
                .and_then(|v| v.as_u64())
                .unwrap_or(line as u64) as u32;
            let end_column = msg
                .get("endColumn")
                .and_then(|v| v.as_u64())
                .unwrap_or((column as u64) + 1) as u32;
            let severity_num = msg.get("severity").and_then(|v| v.as_u64()).unwrap_or(1);
            let severity = if severity_num >= 2 { "error" } else { "warning" };
            let message = msg
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("ESLint")
                .to_string();
            out.push(EslintDiag {
                line,
                column,
                end_line,
                end_column,
                severity: severity.into(),
                message,
            });
        }
    }
    Ok(out)
}
