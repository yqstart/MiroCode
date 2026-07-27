//! 极简 SSH Shell + SFTP（ssh2）。
//!
//! - Shell：交互式远程终端，输出经 `ssh://data/{id}` 推送
//! - SFTP：列目录、上传文件
//! - 密码仅内存使用，不落盘

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ssh2::{Channel, Session, Sftp};
use tauri::{AppHandle, Emitter, State};

type CmdResult<T> = Result<T, String>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    /// `password` | `key`
    pub auth_kind: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

struct ShellSession {
    stop: Arc<AtomicBool>,
    /// 持有 Session 以延长生命周期（Channel 依赖它）
    #[allow(dead_code)]
    session: Arc<Mutex<Session>>,
    channel: Arc<Mutex<Channel>>,
}

struct SftpSession {
    _session: Session,
    sftp: Sftp,
}

pub struct SshState {
    shells: Mutex<HashMap<String, ShellSession>>,
    sftps: Mutex<HashMap<String, SftpSession>>,
}

impl Default for SshState {
    fn default() -> Self {
        Self {
            shells: Mutex::new(HashMap::new()),
            sftps: Mutex::new(HashMap::new()),
        }
    }
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            return PathBuf::from(home).join(rest);
        }
    }
    if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(path)
}

fn connect_session(cfg: &SshConnectConfig) -> CmdResult<Session> {
    let host = cfg.host.trim();
    if host.is_empty() {
        return Err("主机不能为空".into());
    }
    let user = cfg.username.trim();
    if user.is_empty() {
        return Err("用户名不能为空".into());
    }
    let port = if cfg.port == 0 { 22 } else { cfg.port };

    let addr = format!("{host}:{port}");
    let tcp = TcpStream::connect(&addr).map_err(|e| format!("连接失败 {addr}: {e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;

    let mut sess = Session::new().map_err(|e| format!("创建 SSH 会话失败: {e}"))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH 握手失败: {e}"))?;

    match cfg.auth_kind.as_str() {
        "key" => {
            let key_path = cfg
                .private_key_path
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("~/.ssh/id_ed25519");
            let key = expand_home(key_path);
            if !key.exists() {
                // 回退 id_rsa
                let rsa = expand_home("~/.ssh/id_rsa");
                if rsa.exists() {
                    let pass = cfg.passphrase.as_deref();
                    sess.userauth_pubkey_file(user, None, &rsa, pass)
                        .map_err(|e| format!("公钥认证失败: {e}"))?;
                } else {
                    return Err(format!("私钥不存在: {}", key.display()));
                }
            } else {
                let pass = cfg.passphrase.as_deref();
                sess.userauth_pubkey_file(user, None, &key, pass)
                    .map_err(|e| format!("公钥认证失败: {e}"))?;
            }
        }
        _ => {
            let password = cfg
                .password
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "密码不能为空".to_string())?;
            sess.userauth_password(user, password)
                .map_err(|e| format!("密码认证失败: {e}"))?;
        }
    }

    if !sess.authenticated() {
        return Err("SSH 认证未通过".into());
    }
    Ok(sess)
}

fn join_remote(parent: &str, name: &str) -> String {
    if parent == "/" || parent.is_empty() {
        format!("/{name}")
    } else if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

// ==================== SSH Shell ====================

#[tauri::command]
pub fn ssh_shell_open(
    app: AppHandle,
    state: State<'_, SshState>,
    id: String,
    config: SshConnectConfig,
    cols: u32,
    rows: u32,
) -> CmdResult<()> {
    {
        let shells = state.shells.lock().map_err(|e| e.to_string())?;
        if shells.contains_key(&id) {
            return Err("该 SSH 会话已存在".into());
        }
    }

    let sess = connect_session(&config)?;
    sess.set_timeout(200);

    let mut channel = sess
        .channel_session()
        .map_err(|e| format!("打开通道失败: {e}"))?;
    channel
        .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
        .map_err(|e| format!("申请 PTY 失败: {e}"))?;
    channel
        .shell()
        .map_err(|e| format!("启动远程 shell 失败: {e}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let session = Arc::new(Mutex::new(sess));
    let channel = Arc::new(Mutex::new(channel));

    {
        let mut shells = state.shells.lock().map_err(|e| e.to_string())?;
        shells.insert(
            id.clone(),
            ShellSession {
                stop: Arc::clone(&stop),
                session: Arc::clone(&session),
                channel: Arc::clone(&channel),
            },
        );
    }

    let reader_id = id.clone();
    thread::spawn(move || {
        let event_data = format!("ssh://data/{reader_id}");
        let event_exit = format!("ssh://exit/{reader_id}");
        let mut buf = [0u8; 8192];
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let read_result = {
                let mut ch = match channel.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                ch.read(&mut buf)
            };
            match read_result {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(&event_data, chunk);
                }
                Err(err) => {
                    let kind = err.kind();
                    if kind == std::io::ErrorKind::WouldBlock
                        || kind == std::io::ErrorKind::TimedOut
                    {
                        thread::sleep(Duration::from_millis(16));
                        continue;
                    }
                    break;
                }
            }
        }
        let _ = app.emit(&event_exit, ());
    });

    Ok(())
}

#[tauri::command]
pub fn ssh_shell_write(state: State<'_, SshState>, id: String, data: String) -> CmdResult<()> {
    let shells = state.shells.lock().map_err(|e| e.to_string())?;
    let shell = shells.get(&id).ok_or_else(|| "SSH 会话不存在".to_string())?;
    let mut ch = shell.channel.lock().map_err(|e| e.to_string())?;
    ch.write_all(data.as_bytes())
        .map_err(|e| format!("写入失败: {e}"))?;
    let _ = ch.flush();
    Ok(())
}

#[tauri::command]
pub fn ssh_shell_resize(
    state: State<'_, SshState>,
    id: String,
    cols: u32,
    rows: u32,
) -> CmdResult<()> {
    let shells = state.shells.lock().map_err(|e| e.to_string())?;
    let shell = shells.get(&id).ok_or_else(|| "SSH 会话不存在".to_string())?;
    let mut ch = shell.channel.lock().map_err(|e| e.to_string())?;
    ch.request_pty_size(cols, rows, None, None)
        .map_err(|e| format!("调整尺寸失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_shell_close(state: State<'_, SshState>, id: String) -> CmdResult<()> {
    let mut shells = state.shells.lock().map_err(|e| e.to_string())?;
    if let Some(shell) = shells.remove(&id) {
        shell.stop.store(true, Ordering::SeqCst);
        if let Ok(mut ch) = shell.channel.lock() {
            let _ = ch.close();
            let _ = ch.wait_close();
        }
    }
    Ok(())
}

// ==================== SFTP ====================

#[tauri::command]
pub fn sftp_open(
    state: State<'_, SshState>,
    id: String,
    config: SshConnectConfig,
) -> CmdResult<()> {
    {
        let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
        if sftps.contains_key(&id) {
            return Err("该 SFTP 会话已存在".into());
        }
    }

    let sess = connect_session(&config)?;
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败: {e}"))?;

    let mut sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    sftps.insert(
        id,
        SftpSession {
            _session: sess,
            sftp,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn sftp_list(state: State<'_, SshState>, id: String, path: String) -> CmdResult<Vec<SftpEntry>> {
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;

    let remote = if path.trim().is_empty() {
        "."
    } else {
        path.trim()
    };
    let entries = session
        .sftp
        .readdir(Path::new(remote))
        .map_err(|e| format!("读取目录失败: {e}"))?;

    let base = if remote == "." {
        match session.sftp.realpath(Path::new(".")) {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => "/".into(),
        }
    } else {
        remote.to_string()
    };

    let mut out: Vec<SftpEntry> = entries
        .into_iter()
        .filter_map(|(p, stat)| {
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| p.to_string_lossy().to_string());
            if name == "." || name == ".." {
                return None;
            }
            let is_dir = stat.is_dir();
            let full = join_remote(&base, &name);
            Some(SftpEntry {
                name,
                path: full,
                is_dir,
                size: stat.size.unwrap_or(0),
            })
        })
        .collect();

    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub fn sftp_pwd(state: State<'_, SshState>, id: String) -> CmdResult<String> {
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;
    let path = session
        .sftp
        .realpath(Path::new("."))
        .map_err(|e| format!("获取当前目录失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn sftp_upload(
    state: State<'_, SshState>,
    id: String,
    local_path: String,
    remote_path: String,
) -> CmdResult<()> {
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;

    let mut local = std::fs::File::open(&local_path)
        .map_err(|e| format!("打开本地文件失败: {e}"))?;
    let mut remote = session
        .sftp
        .create(Path::new(&remote_path))
        .map_err(|e| format!("创建远程文件失败: {e}"))?;

    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = local
            .read(&mut buf)
            .map_err(|e| format!("读取本地文件失败: {e}"))?;
        if n == 0 {
            break;
        }
        remote
            .write_all(&buf[..n])
            .map_err(|e| format!("写入远程文件失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn sftp_close(state: State<'_, SshState>, id: String) -> CmdResult<()> {
    let mut sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    sftps.remove(&id);
    Ok(())
}
