//! 工作区 Prettier 集成：调用项目本地 npx（需已安装依赖）

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

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
pub async fn format_with_prettier(
    root: String,
    rel_path: String,
    content: String,
) -> Result<String, String> {
    // npx --no-install 首次启动可能联网探测/较慢，wait_with_output 无超时，
    // 放 spawn_blocking + 超时兜底，避免主线程冻结
    let handle = tokio::task::spawn_blocking(move || {
        format_with_prettier_blocking(&root, &rel_path, &content)
    });
    match tokio::time::timeout(std::time::Duration::from_secs(30), handle).await {
        Ok(Ok(r)) => r,
        Ok(Err(join)) => Err(format!("Prettier 任务失败: {join}")),
        Err(_) => Err("Prettier 执行超时（30s），已回退内置格式化引擎".into()),
    }
}

fn format_with_prettier_blocking(
    root: &str,
    rel_path: &str,
    content: &str,
) -> Result<String, String> {
    if !Path::new(&root).is_dir() {
        return Err("工作区无效".into());
    }
    let mut child = npx_cmd()
        .args(["--no-install", "prettier", "--stdin-filepath", rel_path])
        .current_dir(root)
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
