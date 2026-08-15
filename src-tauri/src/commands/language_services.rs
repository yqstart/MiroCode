//! 语言服务捆绑包（按语言独立打包：便携 Node + 单个 language server）
//!
//! 职责：
//! 1. 从远端下载预打包的「语言服务捆绑包」zip（每语言一个 zip，内含便携 Node 与该语言的 server），
//!    sha256 校验后解压到应用数据目录（app_data_dir/language-servers/<language>/），供 LSP 子进程直接使用。
//! 2. 提供多镜像源（GitHub Release / 加速镜像 / 自定义）与自动降级，兼容国内网络。
//!
//! 安装位置刻意不使用「安装目录」：macOS 上写入 App bundle 会破坏代码签名，
//! 且 Tauri updater 整体替换 bundle 会清掉安装产物；应用数据目录与既有
//! ~/.mirocode 凭据体系同域，安全且持久。
//!
//! 产物结构（由 scripts/language-servers/build.mjs 按语言打包生成）：
//! ```text
//! zip/
//!   manifest.json            # { language, version, nodeVersion, platform, entry }
//!   node/                    # 便携 Node 运行时（node / node.exe）
//!   node_modules/            # 该语言对应的 language server 包
//! ```
//!
//! 安装目录（按语言独立）：
//! ```text
//! app_data_dir/language-servers/
//!   ts/
//!     <version>/             # 解压后的 bundle 目录
//!     installed.json         # { version, installedAt }
//!   vue/
//!     <version>/
//!     installed.json
//! ```

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

// ==================== 常量 ====================

/// 安装进度事件名
const LS_EVENT_PROGRESS: &str = "ls://progress";

/// 语言服务根目录名（位于 app_data_dir 下）
const LS_DIR_NAME: &str = "language-servers";

/// 远端版本清单文件名（发布在镜像源根目录）
const LS_MANIFEST_NAME: &str = "ls-latest.json";

/// 本地安装记录文件名（每语言目录下一份）
const LS_INSTALLED_NAME: &str = "installed.json";

/// 官方源：GitHub Release 固定 tag `language-servers`（每次发布覆盖更新该 Release）
const GITHUB_BASE: &str =
    "https://github.com/yqstart/MiroCode/releases/download/language-servers";

/// 国内加速镜像：ghproxy 类通用 GitHub 下载加速
const GHPROXY_BASE: &str =
    "https://ghfast.top/https://github.com/yqstart/MiroCode/releases/download/language-servers";

/// 安装/卸载互斥锁（按语言粒度，避免并发安装造成目录竞争；tokio Mutex 保证 async 内 Send）
static LS_OPS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn ls_ops_lock() -> &'static Mutex<()> {
    LS_OPS_LOCK.get_or_init(|| Mutex::new(()))
}

// ==================== 类型 ====================

/// 远端版本清单（ls-latest.json）--双层结构：顶层 languages map
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteManifest {
    /// 清单版本（展示用）
    #[allow(dead_code)]
    pub version: String,
    /// 语言 -> 该语言的版本清单
    pub languages: HashMap<String, LanguageManifest>,
}

/// 单语言的远端版本清单
#[derive(Debug, Clone, Deserialize)]
pub struct LanguageManifest {
    /// 该语言捆绑包版本
    pub version: String,
    /// 平台标识 -> 产物信息
    pub platforms: HashMap<String, PlatformAsset>,
}

/// 单个平台的产物信息
#[derive(Debug, Clone, Deserialize)]
pub struct PlatformAsset {
    /// 相对文件名（应用端拼镜像源 base）
    pub url: String,
    /// sha256 十六进制
    pub sha256: String,
}

/// 捆绑包内部 manifest.json（打包时生成，单语言单入口）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    /// 语言标识（"ts" / "vue" / ...）
    #[allow(dead_code)]
    language: String,
    version: String,
    /// Node 运行时版本（展示用，当前未读）
    #[allow(dead_code)]
    node_version: String,
    /// 打包平台标识（展示/排查用，当前未读）
    #[allow(dead_code)]
    platform: String,
    /// server 在 node_modules 内的相对入口 JS 路径
    entry: String,
}

/// 本地安装记录（每语言独立一份）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledRecord {
    version: String,
    installed_at: String,
}

/// ls_status 返回：本地安装版本 + 远端最新版本（离线时 latest 为 null）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LsStatus {
    /// 当前平台是否有可用产物（决定「安装」按钮是否可用）
    pub supported: bool,
    /// 已安装版本（未安装为 null）
    pub installed_version: Option<String>,
    /// 远端最新版本（清单拉取失败/离线为 null）
    pub latest_version: Option<String>,
    /// 远端清单是否拉取成功
    pub latest_available: bool,
    /// 实际命中的镜像源 id（"github" / "ghproxy" / "custom"）
    pub mirror_used: String,
    /// 是否有可用更新（已安装 && 远端更新）
    pub has_update: bool,
}

/// 进度事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LsProgress {
    /// 阶段：manifest / download / verify / extract / done
    phase: String,
    received: u64,
    total: u64,
    /// 0-100（download 阶段有意义的百分比）
    percent: f64,
    message: String,
}

// ==================== 路径 ====================

/// 语言服务根目录：app_data_dir/language-servers
fn ls_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?
        .join(LS_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建语言服务目录: {e}"))?;
    Ok(dir)
}

/// 单语言根目录：<root>/<language>
fn ls_lang_root(root: &Path, language: &str) -> PathBuf {
    root.join(language)
}

/// 校验语言名 / 版本号是安全的单级路径段（拒绝路径分隔符、`..` 等逃逸字符）。
/// language 来自前端 invoke，version 来自远端清单或本地 installed.json，均为
/// 不可信输入：直接 join 拼接可被构造为路径穿越（任意目录删除 / 任意文件写）。
fn is_safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// 本地安装记录路径：<lang_root>/installed.json
fn installed_path(lang_root: &Path) -> PathBuf {
    lang_root.join(LS_INSTALLED_NAME)
}

/// 版本目录路径：<lang_root>/<version>
fn version_dir(lang_root: &Path, version: &str) -> PathBuf {
    lang_root.join(version)
}

// ==================== 镜像解析 ====================

/// 按用户选择的镜像策略解析有序 base 列表（失败自动按序降级）
fn resolve_bases(mirror: &str, custom_base: Option<String>) -> Vec<(String, String)> {
    match mirror {
        "github" => vec![("github".to_string(), GITHUB_BASE.to_string())],
        "ghproxy" => vec![("ghproxy".to_string(), GHPROXY_BASE.to_string())],
        "custom" => {
            if let Some(base) = custom_base.filter(|b| !b.trim().is_empty()) {
                vec![("custom".to_string(), base.trim_end_matches('/').to_string())]
            } else {
                Vec::new()
            }
        }
        // auto：官方源优先，国内加速镜像兜底
        _ => vec![
            ("github".to_string(), GITHUB_BASE.to_string()),
            ("ghproxy".to_string(), GHPROXY_BASE.to_string()),
        ],
    }
}

/// 当前平台标识（与打包脚本 scripts/language-servers 对齐）
fn platform_key() -> Result<&'static str, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        Ok("darwin-arm64")
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        Ok("darwin-x64")
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        Ok("win32-x64")
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        Ok("linux-x64")
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        Ok("linux-arm64")
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64")
    )))]
    {
        Err("当前平台暂不支持语言服务".into())
    }
}

// ==================== 本地状态读写 ====================

/// 读取指定语言的安装记录
fn read_installed(lang_root: &Path) -> Option<InstalledRecord> {
    let raw = std::fs::read_to_string(installed_path(lang_root)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 写入指定语言的安装记录
fn write_installed(lang_root: &Path, record: &InstalledRecord) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    let path = installed_path(lang_root);
    std::fs::create_dir_all(lang_root).map_err(|e| format!("创建语言目录失败: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("写入安装记录失败: {e}"))
}

/// 读取指定语言激活 bundle 的运行时信息（供 lsp.rs 启动子进程）
///
/// 返回 node 可执行文件绝对路径与 server 入口绝对路径。
/// 未安装 / 记录损坏 / 目录缺失时返回 None（调用方回退 npx 流程）。
pub struct BundledRuntime {
    pub version: String,
    pub node_path: PathBuf,
    /// server 入口 JS 绝对路径（单语言单入口）
    pub entry: PathBuf,
}

/// 解析指定语言的激活捆绑包运行时；失败返回 None（不阻塞 LSP 回退）
pub fn bundled_runtime(app: &AppHandle, language: &str) -> Option<BundledRuntime> {
    if !is_safe_segment(language) {
        return None;
    }
    let root = ls_root(app).ok()?;
    let lang_root = ls_lang_root(&root, language);
    let record = read_installed(&lang_root)?;
    if !is_safe_segment(&record.version) {
        return None;
    }
    let dir = version_dir(&lang_root, &record.version);
    if !dir.is_dir() {
        return None;
    }
    resolve_bundle_dir(&dir)
}

/// 解析捆绑包目录，返回运行时信息（node 路径 + server 入口）
///
/// 纯路径解析（不依赖 AppHandle），便于单元测试：
/// - 目录存在 manifest.json（BundleManifest）
/// - node 可执行文件：Windows 为 node/node.exe，Unix 为 node/bin/node
/// - entry 指向的 JS 入口存在
/// - Unix 下 node 必须带执行位（历史事故：解压丢 +x 导致检测「可用」但启动全挂，
///   LSP 状态栏一直「降级」；校验失败返回 None 回退宿主 npx）
fn resolve_bundle_dir(dir: &Path) -> Option<BundledRuntime> {
    let raw = std::fs::read_to_string(dir.join("manifest.json")).ok()?;
    let bundle: BundleManifest = serde_json::from_str(&raw).ok()?;

    // Windows 便携包结构为 node/node.exe；Unix 为 node/bin/node（打包脚本统一剥离顶层目录）
    let node_candidates: &[&str] = if cfg!(target_os = "windows") {
        &["node/node.exe"]
    } else {
        &["node/bin/node"]
    };
    let node_path = node_candidates
        .iter()
        .map(|p| dir.join(p))
        .find(|p| is_executable_file(p))?;

    let entry = dir.join(&bundle.entry);
    if !entry.exists() {
        return None;
    }

    Some(BundledRuntime {
        version: bundle.version,
        node_path,
        entry,
    })
}

/// 文件存在且可执行：Unix 校验 mode 的任意执行位；Windows 仅存在即可（.exe）
#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

// ==================== 远端清单 ====================

async fn fetch_manifest(
    mirror: &str,
    custom_base: Option<String>,
) -> Result<(RemoteManifest, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let bases = resolve_bases(mirror, custom_base);
    if bases.is_empty() {
        return Err("请先配置自定义镜像地址".into());
    }

    let mut errors = Vec::new();
    for (id, base) in &bases {
        let url = format!("{base}/{LS_MANIFEST_NAME}");
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<RemoteManifest>().await {
                    Ok(manifest) => return Ok((manifest, id.clone())),
                    Err(e) => errors.push(format!("{url} 解析失败: {e}")),
                }
            }
            Ok(resp) => {
                errors.push(format!("{url} HTTP {}", resp.status()));
            }
            Err(e) => {
                errors.push(format!("{url} 请求失败: {e}"));
            }
        }
    }

    Err(format!(
        "无法获取语言服务版本清单（已尝试 {} 个镜像源）: {}",
        bases.len(),
        errors.join("；")
    ))
}

// ==================== 下载 / 校验 / 解压 ====================

/// 流式下载到临时文件，实时推送进度事件
async fn download_zip(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    // 捆绑包 zip 大小上限：恶意/被劫持镜像可无限流式下发（content_length 可伪造
    // 或缺失）撑爆磁盘。实际产物（便携 Node + server）远小于此值。
    const MAX_ZIP_BYTES: u64 = 512 * 1024 * 1024;

    let total = resp.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("创建临时文件失败: {e}"))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        received += chunk.len() as u64;
        if received > MAX_ZIP_BYTES {
            drop(file);
            let _ = std::fs::remove_file(dest);
            return Err(format!(
                "下载超出大小上限（{}MB），已中止",
                MAX_ZIP_BYTES / 1024 / 1024
            ));
        }
        let percent = if total > 0 {
            (received as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        // 进度节流：每 256KB 或末尾推送一次，避免事件风暴
        if received % (256 * 1024) < chunk.len() as u64 || received == total {
            let _ = app.emit(
                LS_EVENT_PROGRESS,
                LsProgress {
                    phase: "download".into(),
                    received,
                    total,
                    percent,
                    message: String::new(),
                },
            );
        }
    }
    Ok(())
}

/// 计算文件 sha256（十六进制小写）；流式分块计算，
/// 避免把整个 zip（可达数百 MB）一次性读入内存
fn sha256_hex(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| format!("读取下载文件失败: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("读取下载文件失败: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}

/// 解压 zip 到目标目录（防路径穿越；同步执行，调用方放入 spawn_blocking）
fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("打开 zip 失败: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("解析 zip 失败: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取 zip 条目失败: {e}"))?;
        let name = entry.name().to_string();
        // 防路径穿越：拒绝绝对路径与 .. 目录
        let safe = Path::new(&name)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)));
        if !safe {
            return Err(format!("zip 包含非法路径: {name}"));
        }
        let target = dest.join(&name);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            // zip 记录的 unix 权限位需在 copy 前取出（copy 消费 &mut entry）
            let unix_mode = entry.unix_mode();
            let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            // File::create 产物一律 644，这里恢复执行位（Node 二进制缺 +x 会导致
            // LSP 检测「可用」但 spawn 全线失败 → 状态栏一直「LSP 降级」）
            apply_extracted_permissions(&target, unix_mode, &name);
        }
    }
    Ok(())
}

/// 解压后恢复文件权限：优先应用 zip 记录的 unix 权限位；bin 目录（node/bin/）
/// 下的文件强制补执行位，即使 zip 侧 mode 缺失或错误也能保证 Node 可启动。
#[cfg(unix)]
fn apply_extracted_permissions(path: &Path, unix_mode: Option<u32>, entry_name: &str) {
    use std::os::unix::fs::PermissionsExt;
    let in_bin = entry_name.split('/').any(|seg| seg == "bin");
    let mode = match unix_mode {
        Some(m) if m != 0 => {
            if in_bin {
                m | 0o111
            } else {
                m
            }
        }
        _ => {
            if in_bin {
                0o755
            } else {
                0o644
            }
        }
    };
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn apply_extracted_permissions(_path: &Path, _unix_mode: Option<u32>, _entry_name: &str) {}

/// 删除目录（忽略错误，尽力清理）
/// 删除文件或目录（尽力清理，忽略错误）。
/// 对文件调用 remove_dir_all 会失败——下载失败的半截 zip 靠它清不掉
fn remove_dir_if_exists(path: &Path) {
    if path.is_file() {
        let _ = std::fs::remove_file(path);
    } else if path.exists() {
        let _ = std::fs::remove_dir_all(path);
    }
}

/// 清理旧版本：保留指定版本，其余版本目录全部删除
fn prune_old_versions(lang_root: &Path, keep_version: &str) {
    if let Ok(entries) = std::fs::read_dir(lang_root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == LS_INSTALLED_NAME {
                continue; // .tmp / 隐藏目录 / installed.json
            }
            if name != keep_version && entry.path().is_dir() {
                remove_dir_if_exists(&entry.path());
            }
        }
    }
}

// ==================== 命令 ====================

/// 查询指定语言的服务状态：本地安装版本 + 远端最新版本（顺带做镜像连通性探测）
#[tauri::command]
pub async fn ls_status(
    app: AppHandle,
    language: String,
    mirror: String,
    custom_base: Option<String>,
) -> Result<LsStatus, String> {
    let root = ls_root(&app)?;
    let lang_root = ls_lang_root(&root, &language);
    let supported = platform_key().is_ok();

    // 本地安装版本
    let installed_version = read_installed(&lang_root).map(|r| r.version);
    if let Some(v) = &installed_version {
        // 记录存在但目录缺失时视为未安装
        if !version_dir(&lang_root, v).is_dir() {
            let _ = std::fs::remove_file(installed_path(&lang_root));
            return Ok(LsStatus {
                supported,
                installed_version: None,
                latest_version: None,
                latest_available: false,
                mirror_used: String::new(),
                has_update: false,
            });
        }
    }

    // 远端最新版本（失败不阻塞：离线时仅返回本地状态）
    match fetch_manifest(&mirror, custom_base).await {
        Ok((manifest, mirror_used)) => {
            let latest_version = manifest
                .languages
                .get(&language)
                .and_then(|lm| lm.platforms.get(platform_key().unwrap_or_default()))
                .map(|_| {
                    manifest
                        .languages
                        .get(&language)
                        .map(|lm| lm.version.clone())
                        .unwrap_or_default()
                });
            let has_update = matches!(
                (&installed_version, &latest_version),
                (Some(cur), Some(latest)) if cur != latest
            );
            Ok(LsStatus {
                supported,
                installed_version,
                latest_version,
                latest_available: true,
                mirror_used,
                has_update,
            })
        }
        Err(_) => Ok(LsStatus {
            supported,
            installed_version,
            latest_version: None,
            latest_available: false,
            mirror_used: String::new(),
            has_update: false,
        }),
    }
}

/// 安装 / 更新指定语言的语言服务捆绑包
///
/// 流程：拉版本清单 -> 流式下载 zip（进度事件）-> sha256 校验 -> 解压 -> 激活新版本 -> 清理旧版本。
/// 已安装同版本时幂等直接返回。
#[tauri::command]
pub async fn ls_install(
    app: AppHandle,
    language: String,
    mirror: String,
    custom_base: Option<String>,
) -> Result<String, String> {
    let _guard = ls_ops_lock().lock().await;

    if !is_safe_segment(&language) {
        return Err(format!("非法的语言标识「{language}」"));
    }
    let root = ls_root(&app)?;
    let lang_root = ls_lang_root(&root, &language);
    std::fs::create_dir_all(&lang_root).map_err(|e| format!("创建语言目录失败: {e}"))?;
    let platform = platform_key()?;

    let emit = |phase: &str, received: u64, total: u64, percent: f64, message: &str| {
        let _ = app.emit(
            LS_EVENT_PROGRESS,
            LsProgress {
                phase: phase.into(),
                received,
                total,
                percent,
                message: message.into(),
            },
        );
    };

    // 1. 拉版本清单（多镜像自动降级）
    emit("manifest", 0, 0, 0.0, "");
    let (manifest, mirror_used) = fetch_manifest(&mirror, custom_base.clone()).await?;

    let lang_manifest = manifest.languages.get(&language).ok_or_else(|| {
        format!("远端清单不含语言「{language}」的产物")
    })?;
    // version 参与后续路径拼接（zip 名 / 解压目录 / 版本目录），必须先做段校验，
    // 恶意镜像可借此构造 `../..` 逃逸到 app_data_dir 之外
    if !is_safe_segment(&lang_manifest.version) {
        return Err(format!(
            "远端清单包含非法版本号「{}」，已拒绝安装",
            lang_manifest.version
        ));
    }
    let asset = lang_manifest
        .platforms
        .get(platform)
        .cloned()
        .ok_or_else(|| format!("当前平台 {platform} 暂未发布 {language} 语言服务捆绑包"))?;

    // 幂等：已安装同版本直接返回
    if let Some(cur) = read_installed(&lang_root) {
        if cur.version == lang_manifest.version
            && version_dir(&lang_root, &lang_manifest.version).is_dir()
        {
            return Ok(lang_manifest.version.clone());
        }
    }

    // 2. 流式下载
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let tmp_dir = lang_root.join(".tmp");
    remove_dir_if_exists(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let zip_path = tmp_dir.join(format!(
        "ls-{language}-{}-{platform}.zip",
        lang_manifest.version
    ));

    // 依次尝试镜像源下载（下载失败自动切下一个源）
    let bases = resolve_bases(&mirror, custom_base);
    let mut download_errors = Vec::new();
    let mut downloaded = false;
    for (_, base) in &bases {
        let url = format!("{base}/{}", asset.url);
        emit("download", 0, 0, 0.0, &format!("mirror={mirror_used}"));
        match download_zip(&app, &client, &url, &zip_path).await {
            Ok(()) => {
                downloaded = true;
                break;
            }
            Err(e) => {
                download_errors.push(format!("{url}: {e}"));
                remove_dir_if_exists(&zip_path);
            }
        }
    }
    if !downloaded {
        remove_dir_if_exists(&tmp_dir);
        return Err(format!(
            "下载失败（已尝试 {} 个镜像源）: {}",
            bases.len(),
            download_errors.join("；")
        ));
    }

    // 3. sha256 校验
    emit("verify", 0, 0, 0.0, "");
    let actual = sha256_hex(&zip_path)?;
    if !actual.eq_ignore_ascii_case(&asset.sha256) {
        remove_dir_if_exists(&tmp_dir);
        return Err(format!(
            "完整性校验失败（期望 {}，实际 {}），请检查网络或镜像源",
            asset.sha256, actual
        ));
    }

    // 4. 解压到临时目录，成功后原子改名激活
    emit("extract", 0, 0, 0.0, "");
    let unpack_dir = tmp_dir.join(&lang_manifest.version);
    std::fs::create_dir_all(&unpack_dir).map_err(|e| e.to_string())?;

    let zip_clone = zip_path.clone();
    let unpack_clone = unpack_dir.clone();
    tokio::task::spawn_blocking(move || extract_zip(&zip_clone, &unpack_clone))
        .await
        .map_err(|e| format!("解压任务失败: {e}"))??;

    // 校验 bundle 内部 manifest 存在且版本匹配
    let bundle_raw = std::fs::read_to_string(unpack_dir.join("manifest.json"))
        .map_err(|_| "捆绑包缺少 manifest.json，已中止安装".to_string())?;
    let bundle: BundleManifest =
        serde_json::from_str(&bundle_raw).map_err(|e| format!("捆绑包 manifest 解析失败: {e}"))?;
    if bundle.version != lang_manifest.version {
        remove_dir_if_exists(&tmp_dir);
        return Err(format!(
            "捆绑包版本不匹配（期望 {}，实际 {}）",
            lang_manifest.version, bundle.version
        ));
    }

    let final_dir = version_dir(&lang_root, &lang_manifest.version);
    if final_dir.exists() {
        remove_dir_if_exists(&final_dir);
    }
    std::fs::rename(&unpack_dir, &final_dir).map_err(|e| format!("激活新版本失败: {e}"))?;

    // 5. 记录激活版本 + 清理旧版本与临时文件
    write_installed(
        &lang_root,
        &InstalledRecord {
            version: lang_manifest.version.clone(),
            installed_at: chrono::Local::now().to_rfc3339(),
        },
    )?;
    prune_old_versions(&lang_root, &lang_manifest.version);
    remove_dir_if_exists(&tmp_dir);

    emit("done", 0, 0, 100.0, "");
    Ok(lang_manifest.version.clone())
}

/// 卸载指定语言的语言服务捆绑包（删除版本目录与安装记录）
#[tauri::command]
pub async fn ls_uninstall(app: AppHandle, language: String) -> Result<(), String> {
    let _guard = ls_ops_lock().lock().await;

    if !is_safe_segment(&language) {
        return Err(format!("非法的语言标识「{language}」"));
    }
    let root = ls_root(&app)?;
    let lang_root = ls_lang_root(&root, &language);
    if let Some(record) = read_installed(&lang_root) {
        // installed.json 属本地数据但也可能被篡改：版本号非法时拒绝删除目录
        if !is_safe_segment(&record.version) {
            return Err(format!(
                "安装记录中的版本号非法「{}」，已拒绝卸载",
                record.version
            ));
        }
        remove_dir_if_exists(&version_dir(&lang_root, &record.version));
    }
    let _ = std::fs::remove_file(installed_path(&lang_root));
    Ok(())
}

// ==================== 测试 ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_bases_auto() {
        let bases = resolve_bases("auto", None);
        assert_eq!(bases.len(), 2);
        assert_eq!(bases[0].0, "github");
        assert_eq!(bases[1].0, "ghproxy");
    }

    #[test]
    fn test_resolve_bases_custom() {
        let bases = resolve_bases("custom", Some("https://cdn.example.com/ls".into()));
        assert_eq!(bases.len(), 1);
        assert_eq!(bases[0].1, "https://cdn.example.com/ls");
    }

    #[test]
    fn test_resolve_bases_custom_empty() {
        let bases = resolve_bases("custom", None);
        assert!(bases.is_empty());
    }

    #[test]
    fn test_sha256_hex_known_vector() {
        // sha256("abc") 的已知向量
        let dir = std::env::temp_dir().join(format!("ls-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("abc.txt");
        std::fs::write(&file, b"abc").unwrap();
        let hex = sha256_hex(&file).unwrap();
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 构造一个结构完整的假 bundle 目录（与打包脚本产物结构一致，单语言单入口）
    fn make_fake_bundle(dir: &std::path::Path, language: &str, version: &str) {
        // node 可执行文件（Unix 结构 node/bin/node；Windows 结构 node/node.exe）
        if cfg!(target_os = "windows") {
            std::fs::create_dir_all(dir.join("node")).unwrap();
            std::fs::write(dir.join("node/node.exe"), b"fake").unwrap();
        } else {
            std::fs::create_dir_all(dir.join("node/bin")).unwrap();
            let node_path = dir.join("node/bin/node");
            std::fs::write(&node_path, b"#!/bin/sh\nexit 0\n").unwrap();
            // resolve_bundle_dir 校验执行位，夹具需与真实安装产物一致（带 +x）
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&node_path, std::fs::Permissions::from_mode(0o755))
                    .unwrap();
            }
        }
        // server 入口（按语言不同）
        let entry = match language {
            "ts" => "node_modules/typescript-language-server/lib/cli.mjs",
            "vue" => "node_modules/@vue/language-server/bin/vue-language-server.js",
            _ => "node_modules/fake-server/index.js",
        };
        let entry_path = dir.join(entry);
        std::fs::create_dir_all(entry_path.parent().unwrap()).unwrap();
        std::fs::write(&entry_path, b"// fake\n").unwrap();
        // manifest.json（单语言单入口格式）
        std::fs::write(
            dir.join("manifest.json"),
            serde_json::json!({
                "language": language,
                "version": version,
                "nodeVersion": "22.14.0",
                "platform": "darwin-arm64",
                "entry": entry,
            })
            .to_string(),
        )
        .unwrap();
    }

    #[test]
    fn test_resolve_bundle_dir_valid_ts() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path(), "ts", "0.2.0");

        let rt = resolve_bundle_dir(dir.path()).expect("应能解析合法 bundle");
        assert_eq!(rt.version, "0.2.0");
        if cfg!(target_os = "windows") {
            assert_eq!(rt.node_path, dir.path().join("node/node.exe"));
        } else {
            assert_eq!(rt.node_path, dir.path().join("node/bin/node"));
        }
        assert!(rt.entry.ends_with("typescript-language-server/lib/cli.mjs"));
    }

    #[test]
    fn test_resolve_bundle_dir_valid_vue() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path(), "vue", "0.2.0");

        let rt = resolve_bundle_dir(dir.path()).expect("应能解析合法 bundle");
        assert_eq!(rt.version, "0.2.0");
        assert!(rt.entry.ends_with("vue-language-server.js"));
    }

    #[test]
    fn test_resolve_bundle_dir_missing_manifest() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path(), "ts", "0.2.0");
        std::fs::remove_file(dir.path().join("manifest.json")).unwrap();
        assert!(resolve_bundle_dir(dir.path()).is_none());
    }

    #[test]
    fn test_resolve_bundle_dir_missing_entry() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path(), "ts", "0.2.0");
        // 删除 server 入口文件
        std::fs::remove_dir_all(dir.path().join("node_modules/typescript-language-server"))
            .unwrap();
        assert!(resolve_bundle_dir(dir.path()).is_none());
    }

    #[test]
    fn test_resolve_bundle_dir_missing_node() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path(), "ts", "0.2.0");
        std::fs::remove_dir_all(dir.path().join("node")).unwrap();
        assert!(resolve_bundle_dir(dir.path()).is_none());
    }

    /// 历史事故回归：解压丢执行位后 node 以 644 落盘，检测「存在」即判可用，
    /// 实际 spawn 全线失败 → 状态栏一直「LSP 降级」。现应判不可用回退宿主 npx。
    #[cfg(unix)]
    #[test]
    fn test_resolve_bundle_dir_node_not_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path(), "ts", "0.2.0");
        let node_path = dir.path().join("node/bin/node");
        std::fs::set_permissions(&node_path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(resolve_bundle_dir(dir.path()).is_none());
    }

    /// 解压恢复执行位：zip 条目不带 unix 权限记录时，bin 目录下文件补 0o755
    #[cfg(unix)]
    #[test]
    fn test_extract_zip_adds_exec_bit_for_bin() {
        use std::os::unix::fs::PermissionsExt;
        use zip::write::SimpleFileOptions;

        let src = tempfile::tempdir().unwrap();
        let zip_path = src.path().join("bundle.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("node/bin/node", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"fake-node").unwrap();
        writer
            .start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"{}").unwrap();
        writer.finish().unwrap();

        let dest = tempfile::tempdir().unwrap();
        extract_zip(&zip_path, dest.path()).unwrap();
        let node_mode = std::fs::metadata(dest.path().join("node/bin/node"))
            .unwrap()
            .permissions()
            .mode();
        assert_ne!(node_mode & 0o111, 0, "node 应补执行位");
        let manifest_mode = std::fs::metadata(dest.path().join("manifest.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(manifest_mode & 0o111, 0, "普通文件不应获得执行位");
    }

    /// zip 记录了正确权限时原样保留（node 0o755 不被覆盖成 644）
    #[cfg(unix)]
    #[test]
    fn test_extract_zip_preserves_unix_mode() {
        use std::os::unix::fs::PermissionsExt;
        use zip::write::SimpleFileOptions;

        let src = tempfile::tempdir().unwrap();
        let zip_path = src.path().join("bundle.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                "node/bin/node",
                SimpleFileOptions::default().unix_permissions(0o755),
            )
            .unwrap();
        writer.write_all(b"fake-node").unwrap();
        writer.finish().unwrap();

        let dest = tempfile::tempdir().unwrap();
        extract_zip(&zip_path, dest.path()).unwrap();
        let mode = std::fs::metadata(dest.path().join("node/bin/node"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755, "应保留 zip 记录的 0o755");
    }

    #[test]
    fn test_remote_manifest_deserialize() {
        // 验证双层清单格式能正确反序列化
        let raw = serde_json::json!({
            "version": "0.2.0",
            "languages": {
                "ts": {
                    "version": "0.2.0",
                    "platforms": {
                        "darwin-arm64": {
                            "url": "ls-ts-0.2.0-darwin-arm64.zip",
                            "sha256": "abc123"
                        }
                    }
                },
                "vue": {
                    "version": "0.2.0",
                    "platforms": {
                        "darwin-arm64": {
                            "url": "ls-vue-0.2.0-darwin-arm64.zip",
                            "sha256": "def456"
                        }
                    }
                }
            }
        });
        let manifest: RemoteManifest = serde_json::from_value(raw).unwrap();
        assert_eq!(manifest.languages.len(), 2);
        let ts = manifest.languages.get("ts").unwrap();
        assert_eq!(ts.version, "0.2.0");
        assert_eq!(ts.platforms.len(), 1);
        let asset = ts.platforms.get("darwin-arm64").unwrap();
        assert_eq!(asset.url, "ls-ts-0.2.0-darwin-arm64.zip");
        assert_eq!(asset.sha256, "abc123");
    }
}
