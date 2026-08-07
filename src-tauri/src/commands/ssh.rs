//! 极简 SSH Shell + SFTP（ssh2）。
//!
//! - Shell：交互式远程终端，输出经 `ssh://data/{id}` 推送
//! - SFTP：优先复用同一 Shell 的 Session（单 TCP）；否则独立连接
//! - 主机密钥：校验 `~/.ssh/known_hosts` + `~/.mirocode/known_hosts`
//! - 密码凭据：`~/.mirocode/ssh-credentials.json`（0600）

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use ssh2::{
    CheckResult, HashType, KnownHostFileKind, KnownHostKeyFormat, Session, Sftp,
};
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
    /// 用户已确认信任未知主机密钥（TOFU 写入）
    pub accept_unknown_host_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSecretStored {
    pub password: Option<String>,
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
    /// SFTP 操作期间暂停读循环，避免与非阻塞 Session 争用
    pause: Arc<AtomicBool>,
    session: Arc<Mutex<Session>>,
    channel: Arc<Mutex<ssh2::Channel>>,
}

enum SftpBackend {
    Owned {
        _session: Session,
        sftp: Sftp,
    },
    Shared {
        pause: Arc<AtomicBool>,
        session: Arc<Mutex<Session>>,
        sftp: Sftp,
    },
}

struct SftpSession {
    backend: SftpBackend,
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

fn miro_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".mirocode"))
}

fn ssh_cred_store_path() -> Option<PathBuf> {
    Some(miro_dir()?.join("ssh-credentials.json"))
}

fn app_known_hosts_path() -> Option<PathBuf> {
    Some(miro_dir()?.join("known_hosts"))
}

fn system_known_hosts_path() -> PathBuf {
    expand_home("~/.ssh/known_hosts")
}

fn set_file_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
}

fn host_key_fingerprint(sess: &Session) -> String {
    if let Some(hash) = sess.host_key_hash(HashType::Sha256) {
        return format!("SHA256:{}", STANDARD_NO_PAD.encode(hash));
    }
    if let Some(hash) = sess.host_key_hash(HashType::Md5) {
        let hex: Vec<String> = hash.iter().map(|b| format!("{b:02x}")).collect();
        return format!("MD5:{}", hex.join(":"));
    }
    "unknown".into()
}

fn verify_or_trust_host_key(sess: &Session, host: &str, port: u16, accept: bool) -> CmdResult<()> {
    let (key, key_type) = sess
        .host_key()
        .ok_or_else(|| "无法获取服务器主机密钥".to_string())?;
    let fmt: KnownHostKeyFormat = key_type.into();
    let fingerprint = host_key_fingerprint(sess);

    let mut known = sess
        .known_hosts()
        .map_err(|e| format!("初始化 known_hosts 失败: {e}"))?;

    // 系统 + 应用 known_hosts 一并载入（文件不存在则忽略）
    for path in [system_known_hosts_path(), app_known_hosts_path().unwrap_or_default()] {
        if path.as_os_str().is_empty() || !path.exists() {
            continue;
        }
        let _ = known.read_file(&path, KnownHostFileKind::OpenSSH);
    }

    match known.check_port(host, port, key) {
        CheckResult::Match => Ok(()),
        CheckResult::Mismatch => Err(format!(
            "主机密钥不匹配（可能遭受中间人攻击）\n{host}:{port}\n指纹: {fingerprint}"
        )),
        CheckResult::Failure => Err("校验主机密钥失败".into()),
        CheckResult::NotFound => {
            if !accept {
                return Err(format!(
                    "SSH_HOST_KEY_UNKNOWN|{fingerprint}|{host}:{port}"
                ));
            }
            // 只写入应用 known_hosts，避免把系统条目整库拷贝出去
            let path = app_known_hosts_path().ok_or_else(|| "无法定位凭据目录".to_string())?;
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut app_known = sess
                .known_hosts()
                .map_err(|e| format!("初始化 known_hosts 失败: {e}"))?;
            if path.exists() {
                let _ = app_known.read_file(&path, KnownHostFileKind::OpenSSH);
            }
            let entry_host = if port == 22 {
                host.to_string()
            } else {
                format!("[{host}]:{port}")
            };
            app_known
                .add(&entry_host, key, "mirocode", fmt)
                .map_err(|e| format!("写入 known_hosts 失败: {e}"))?;
            app_known
                .write_file(&path, KnownHostFileKind::OpenSSH)
                .map_err(|e| format!("保存 known_hosts 失败: {e}"))?;
            set_file_private(&path);
            Ok(())
        }
    }
}

/// 标准超时 / 非阻塞类错误（可无限次轮询）
fn is_timeout_io_error(err: &std::io::Error) -> bool {
    use std::io::ErrorKind;
    match err.kind() {
        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted => return true,
        _ => {}
    }
    let msg = err.to_string().to_ascii_lowercase();
    msg.contains("timed out")
        || msg.contains("timeout")
        || msg.contains("would block")
        || msg.contains("eagain")
        || msg.contains("socket timeout")
}

/// libssh2 短超时轮询时偶发的瞬时错误；连续出现过多则视为真断连
fn is_soft_transport_error(err: &std::io::Error) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    msg.contains("transport read") || msg.contains("error receiving on socket")
}

fn is_retryable_io_error(err: &std::io::Error) -> bool {
    is_timeout_io_error(err) || is_soft_transport_error(err)
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
    let mut last_err = None;
    let tcp = {
        let addrs = addr
            .to_socket_addrs()
            .map_err(|e| format!("解析地址失败 {addr}: {e}"))?;
        let mut connected = None;
        for socket_addr in addrs {
            match TcpStream::connect_timeout(&socket_addr, Duration::from_secs(15)) {
                Ok(stream) => {
                    connected = Some(stream);
                    break;
                }
                Err(e) => last_err = Some(e),
            }
        }
        connected.ok_or_else(|| {
            format!(
                "连接失败 {addr}: {}",
                last_err
                    .map(|e| e.to_string())
                    .unwrap_or_else(|| "无可用地址".into())
            )
        })?
    };
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;

    let mut sess = Session::new().map_err(|e| format!("创建 SSH 会话失败: {e}"))?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(30_000);
    sess.handshake()
        .map_err(|e| format!("SSH 握手失败: {e}"))?;

    let accept = cfg.accept_unknown_host_key.unwrap_or(false);
    verify_or_trust_host_key(&sess, host, port, accept)?;

    match cfg.auth_kind.as_str() {
        "key" => {
            let key_path = cfg
                .private_key_path
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("~/.ssh/id_ed25519");
            let key = expand_home(key_path);
            if !key.exists() {
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

    sess.set_keepalive(true, 30);
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

/// 拒绝危险远程路径（空、根、空字节、`..` 段）
fn validate_remote_path_str(path: &str) -> CmdResult<()> {
    let remote = path.trim();
    if remote.is_empty() || remote == "/" {
        return Err("非法远程路径".into());
    }
    if remote.contains('\0') {
        return Err("远程路径包含非法字符".into());
    }
    for seg in remote.split(['/', '\\']) {
        if seg == ".." {
            return Err("远程路径不允许包含 ..".into());
        }
    }
    Ok(())
}

fn validate_remote_path(path: &str) -> CmdResult<&Path> {
    validate_remote_path_str(path)?;
    Ok(Path::new(path.trim()))
}

/// SFTP 操作期间等待 pause 解除，避免 Channel 写与 Session 阻塞 I/O 争用
fn wait_shell_io_ready(pause: &AtomicBool, stop: &AtomicBool) -> CmdResult<()> {
    for _ in 0..250 {
        if stop.load(Ordering::SeqCst) {
            return Err("SSH 会话已关闭".into());
        }
        if !pause.load(Ordering::SeqCst) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(10));
    }
    if pause.load(Ordering::SeqCst) {
        return Err("SSH 会话繁忙（SFTP 操作中），请稍后重试".into());
    }
    Ok(())
}

fn write_all_retry(ch: &mut ssh2::Channel, data: &[u8]) -> std::io::Result<()> {
    let mut offset = 0;
    let mut spins = 0;
    while offset < data.len() {
        match ch.write(&data[offset..]) {
            Ok(0) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "SSH 通道写入返回 0",
                ));
            }
            Ok(n) => {
                offset += n;
                spins = 0;
            }
            Err(err) if is_retryable_io_error(&err) => {
                spins += 1;
                if spins > 100 {
                    return Err(err);
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(err) => return Err(err),
        }
    }
    let _ = ch.flush();
    Ok(())
}

fn with_sftp_io<R>(backend: &SftpBackend, f: impl FnOnce(&Sftp) -> CmdResult<R>) -> CmdResult<R> {
    match backend {
        SftpBackend::Owned { sftp, .. } => f(sftp),
        SftpBackend::Shared {
            pause,
            session,
            sftp,
        } => {
            pause.store(true, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(40));
            {
                let sess = session.lock().map_err(|e| e.to_string())?;
                sess.set_blocking(true);
                sess.set_timeout(30_000);
            }
            let result = f(sftp);
            {
                if let Ok(sess) = session.lock() {
                    sess.set_timeout(0);
                    sess.set_blocking(false);
                }
            }
            pause.store(false, Ordering::SeqCst);
            result
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProfileStored {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: String,
    pub private_key_path: String,
    pub remember_secret: Option<bool>,
}

fn ssh_profiles_path() -> Option<PathBuf> {
    Some(miro_dir()?.join("ssh-profiles.json"))
}

#[tauri::command]
pub fn ssh_profiles_load() -> CmdResult<Vec<SshProfileStored>> {
    let path = ssh_profiles_path().ok_or_else(|| "无法定位配置目录".to_string())?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let profiles: Vec<SshProfileStored> =
        serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(profiles)
}

#[tauri::command]
pub fn ssh_profiles_save(profiles: Vec<SshProfileStored>) -> CmdResult<()> {
    let path = ssh_profiles_path().ok_or_else(|| "无法定位配置目录".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let trimmed: Vec<_> = profiles.into_iter().take(20).collect();
    let raw = serde_json::to_string_pretty(&trimmed).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())?;
    set_file_private(&path);
    Ok(())
}

// ==================== SSH 凭据（磁盘 0600） ====================

static CRED_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn cred_store_lock() -> &'static Mutex<()> {
    CRED_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

fn load_cred_map_from_disk(path: &Path) -> CmdResult<HashMap<String, SshSecretStored>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_cred_map_to_disk(path: &Path, map: &HashMap<String, SshSecretStored>) -> CmdResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    set_file_private(path);
    Ok(())
}

fn filter_nonempty_secret(secret: &SshSecretStored) -> Option<SshSecretStored> {
    if secret.password.as_ref().is_some_and(|p| !p.is_empty())
        || secret.passphrase.as_ref().is_some_and(|p| !p.is_empty())
    {
        Some(secret.clone())
    } else {
        None
    }
}

#[tauri::command]
pub fn ssh_secret_get(profile_id: String) -> CmdResult<Option<SshSecretStored>> {
    let path = ssh_cred_store_path().ok_or_else(|| "无法定位凭据目录".to_string())?;
    let _guard = cred_store_lock().lock().map_err(|e| e.to_string())?;
    let map = load_cred_map_from_disk(&path)?;
    Ok(map.get(&profile_id).and_then(filter_nonempty_secret))
}

#[tauri::command]
pub fn ssh_secret_set(profile_id: String, secret: SshSecretStored) -> CmdResult<()> {
    let path = ssh_cred_store_path().ok_or_else(|| "无法定位凭据目录".to_string())?;
    let _guard = cred_store_lock().lock().map_err(|e| e.to_string())?;
    let mut map = load_cred_map_from_disk(&path)?;

    let next = SshSecretStored {
        password: secret.password.filter(|s| !s.is_empty()),
        passphrase: secret.passphrase.filter(|s| !s.is_empty()),
    };
    if next.password.is_none() && next.passphrase.is_none() {
        map.remove(&profile_id);
    } else {
        let merged = if let Some(existing) = map.remove(&profile_id) {
            SshSecretStored {
                password: next.password.or(existing.password),
                passphrase: next.passphrase.or(existing.passphrase),
            }
        } else {
            next
        };
        map.insert(profile_id, merged);
    }
    save_cred_map_to_disk(&path, &map)
}

#[tauri::command]
pub fn ssh_secret_remove(profile_id: String) -> CmdResult<()> {
    let path = ssh_cred_store_path().ok_or_else(|| "无法定位凭据目录".to_string())?;
    let _guard = cred_store_lock().lock().map_err(|e| e.to_string())?;
    let mut map = load_cred_map_from_disk(&path)?;
    if map.remove(&profile_id).is_none() {
        return Ok(());
    }
    save_cred_map_to_disk(&path, &map)
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
    sess.set_timeout(30_000);

    let mut channel = sess
        .channel_session()
        .map_err(|e| format!("打开通道失败: {e}"))?;
    let cols = cols.max(20);
    let rows = rows.max(5);
    channel
        .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
        .map_err(|e| format!("申请 PTY 失败: {e}"))?;
    channel
        .shell()
        .map_err(|e| format!("启动远程 shell 失败: {e}"))?;

    sess.set_timeout(0);
    sess.set_blocking(false);

    let stop = Arc::new(AtomicBool::new(false));
    let pause = Arc::new(AtomicBool::new(false));
    let session = Arc::new(Mutex::new(sess));
    let channel = Arc::new(Mutex::new(channel));

    {
        let mut shells = state.shells.lock().map_err(|e| e.to_string())?;
        shells.insert(
            id.clone(),
            ShellSession {
                stop: Arc::clone(&stop),
                pause: Arc::clone(&pause),
                session: Arc::clone(&session),
                channel: Arc::clone(&channel),
            },
        );
    }

    let reader_id = id.clone();
    thread::spawn(move || {
        let event_data = format!("ssh://data/{reader_id}");
        let event_exit = format!("ssh://exit/{reader_id}");
        let event_error = format!("ssh://error/{reader_id}");
        let mut buf = [0u8; 8192];
        let mut last_error: Option<String> = None;
        let mut soft_err_streak = 0u32;
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            if pause.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(16));
                continue;
            }
            let read_result = {
                let mut ch = match channel.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if ch.eof() {
                    Ok(0)
                } else {
                    ch.read(&mut buf)
                }
            };
            match read_result {
                Ok(0) => break,
                Ok(n) => {
                    soft_err_streak = 0;
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(&event_data, chunk);
                }
                Err(err) => {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    if is_timeout_io_error(&err) {
                        soft_err_streak = 0;
                        thread::sleep(Duration::from_millis(16));
                        continue;
                    }
                    if is_soft_transport_error(&err) {
                        soft_err_streak = soft_err_streak.saturating_add(1);
                        if soft_err_streak <= 60 {
                            thread::sleep(Duration::from_millis(25));
                            continue;
                        }
                    }
                    let closing = channel.lock().map(|ch| ch.eof()).unwrap_or(true);
                    if closing || stop.load(Ordering::SeqCst) {
                        break;
                    }
                    last_error = Some(format!("SSH 通道读取失败: {err}"));
                    break;
                }
            }
        }
        if let Some(msg) = last_error {
            if !stop.load(Ordering::SeqCst) {
                let _ = app.emit(&event_error, msg);
            }
        }
        let _ = app.emit(&event_exit, ());
    });

    Ok(())
}

#[tauri::command]
pub fn ssh_shell_write(state: State<'_, SshState>, id: String, data: String) -> CmdResult<()> {
    let (pause, channel, stop) = {
        let shells = state.shells.lock().map_err(|e| e.to_string())?;
        let shell = shells.get(&id).ok_or_else(|| "SSH 会话不存在".to_string())?;
        if shell.stop.load(Ordering::SeqCst) {
            return Err("SSH 会话已关闭".into());
        }
        (
            Arc::clone(&shell.pause),
            Arc::clone(&shell.channel),
            Arc::clone(&shell.stop),
        )
    };
    wait_shell_io_ready(&pause, &stop)?;
    let mut ch = channel.lock().map_err(|e| e.to_string())?;
    write_all_retry(&mut ch, data.as_bytes()).map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_shell_resize(
    state: State<'_, SshState>,
    id: String,
    cols: u32,
    rows: u32,
) -> CmdResult<()> {
    let (pause, channel, stop) = {
        let shells = state.shells.lock().map_err(|e| e.to_string())?;
        let shell = shells.get(&id).ok_or_else(|| "SSH 会话不存在".to_string())?;
        if shell.stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        (
            Arc::clone(&shell.pause),
            Arc::clone(&shell.channel),
            Arc::clone(&shell.stop),
        )
    };
    let _ = wait_shell_io_ready(&pause, &stop);
    let cols = cols.max(20);
    let rows = rows.max(5);
    let mut ch = channel.lock().map_err(|e| e.to_string())?;
    let _ = ch.request_pty_size(cols, rows, None, None);
    Ok(())
}

#[tauri::command]
pub fn ssh_shell_close(state: State<'_, SshState>, id: String) -> CmdResult<()> {
    // 顺带关掉挂在该 Shell 上的共享 SFTP
    let sftp_id = format!("sftp-{id}");
    {
        let mut sftps = state.sftps.lock().map_err(|e| e.to_string())?;
        sftps.remove(&sftp_id);
    }

    let mut shells = state.shells.lock().map_err(|e| e.to_string())?;
    if let Some(shell) = shells.remove(&id) {
        shell.stop.store(true, Ordering::SeqCst);
        shell.pause.store(false, Ordering::SeqCst);
        if let Ok(mut ch) = shell.channel.lock() {
            let _ = ch.send_eof();
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

    // 优先复用同名 Shell（id = sftp-{shellId}）的 Session，避免第二条 TCP
    if let Some(shell_id) = id.strip_prefix("sftp-") {
        let shells = state.shells.lock().map_err(|e| e.to_string())?;
        if let Some(shell) = shells.get(shell_id) {
            shell.pause.store(true, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(40));
            let sftp = {
                let sess = shell.session.lock().map_err(|e| e.to_string())?;
                sess.set_blocking(true);
                sess.set_timeout(30_000);
                let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败: {e}"))?;
                sess.set_timeout(0);
                sess.set_blocking(false);
                sftp
            };
            let backend = SftpBackend::Shared {
                pause: Arc::clone(&shell.pause),
                session: Arc::clone(&shell.session),
                sftp,
            };
            shell.pause.store(false, Ordering::SeqCst);
            drop(shells);
            let mut sftps = state.sftps.lock().map_err(|e| e.to_string())?;
            sftps.insert(id, SftpSession { backend });
            return Ok(());
        }
    }

    let sess = connect_session(&config)?;
    sess.set_timeout(30_000);
    let sftp = sess.sftp().map_err(|e| format!("打开 SFTP 失败: {e}"))?;
    let mut sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    sftps.insert(
        id,
        SftpSession {
            backend: SftpBackend::Owned {
                _session: sess,
                sftp,
            },
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
    // 浏览允许根目录；写入类操作仍走 validate_remote_path_str
    if remote != "." && remote != "/" {
        validate_remote_path_str(remote)?;
    }

    with_sftp_io(&session.backend, |sftp| {
        let entries = sftp
            .readdir(Path::new(remote))
            .map_err(|e| format!("读取目录失败: {e}"))?;

        let base = if remote == "." {
            match sftp.realpath(Path::new(".")) {
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
    })
}

#[tauri::command]
pub fn sftp_pwd(state: State<'_, SshState>, id: String) -> CmdResult<String> {
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;
    with_sftp_io(&session.backend, |sftp| {
        let path = sftp
            .realpath(Path::new("."))
            .map_err(|e| format!("获取当前目录失败: {e}"))?;
        Ok(path.to_string_lossy().to_string())
    })
}

#[tauri::command]
pub fn sftp_upload(
    state: State<'_, SshState>,
    id: String,
    local_path: String,
    remote_path: String,
) -> CmdResult<()> {
    validate_remote_path_str(&remote_path)?;
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;

    with_sftp_io(&session.backend, |sftp| {
        let mut local =
            std::fs::File::open(&local_path).map_err(|e| format!("打开本地文件失败: {e}"))?;
        let mut remote = sftp
            .create(Path::new(remote_path.trim()))
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
    })
}

#[tauri::command]
pub fn sftp_mkdir(state: State<'_, SshState>, id: String, path: String) -> CmdResult<()> {
    let remote = validate_remote_path(&path)?.to_path_buf();
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;
    with_sftp_io(&session.backend, |sftp| {
        sftp.mkdir(&remote, 0o755)
            .map_err(|e| format!("创建目录失败: {e}"))
    })
}

#[tauri::command]
pub fn sftp_create_file(state: State<'_, SshState>, id: String, path: String) -> CmdResult<()> {
    let remote = validate_remote_path(&path)?.to_path_buf();
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;
    with_sftp_io(&session.backend, |sftp| {
        let _file = sftp
            .create(&remote)
            .map_err(|e| format!("创建文件失败: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub fn sftp_rename(
    state: State<'_, SshState>,
    id: String,
    from: String,
    to: String,
) -> CmdResult<()> {
    let from_path = validate_remote_path(&from)?.to_path_buf();
    let to_path = validate_remote_path(&to)?.to_path_buf();
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;
    with_sftp_io(&session.backend, |sftp| {
        sftp.rename(&from_path, &to_path, None)
            .map_err(|e| format!("重命名失败: {e}"))
    })
}

fn sftp_remove_recursive(sftp: &Sftp, path: &Path) -> CmdResult<()> {
    let meta = sftp
        .stat(path)
        .map_err(|e| format!("读取远程路径失败: {e}"))?;
    if meta.is_dir() {
        let base = path.to_string_lossy().to_string();
        let entries = sftp
            .readdir(path)
            .map_err(|e| format!("读取目录失败: {e}"))?;
        for (child, _) in entries {
            let name = child
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            let full = PathBuf::from(join_remote(&base, &name));
            sftp_remove_recursive(sftp, &full)?;
        }
        sftp.rmdir(path)
            .map_err(|e| format!("删除目录失败: {e}"))?;
    } else {
        sftp.unlink(path)
            .map_err(|e| format!("删除文件失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn sftp_remove(state: State<'_, SshState>, id: String, path: String) -> CmdResult<()> {
    let remote = validate_remote_path(&path)?.to_path_buf();
    let sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    let session = sftps
        .get(&id)
        .ok_or_else(|| "SFTP 会话不存在".to_string())?;
    with_sftp_io(&session.backend, |sftp| sftp_remove_recursive(sftp, &remote))
}

#[tauri::command]
pub fn sftp_close(state: State<'_, SshState>, id: String) -> CmdResult<()> {
    let mut sftps = state.sftps.lock().map_err(|e| e.to_string())?;
    sftps.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_root_and_empty() {
        assert!(validate_remote_path_str("").is_err());
        assert!(validate_remote_path_str("/").is_err());
        assert!(validate_remote_path_str("   ").is_err());
    }

    #[test]
    fn validate_rejects_dotdot() {
        assert!(validate_remote_path_str("/home/../etc/passwd").is_err());
        assert!(validate_remote_path_str("../secret").is_err());
        assert!(validate_remote_path_str("/tmp\\..\\x").is_err());
    }

    #[test]
    fn validate_accepts_normal() {
        assert!(validate_remote_path_str("/home/user/file.txt").is_ok());
        assert!(validate_remote_path_str("/var/log").is_ok());
    }
}
