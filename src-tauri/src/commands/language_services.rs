//! 语言服务捆绑包（内置 Node + typescript-language-server + @vue/language-server）
//!
//! 职责：
//! 1. 从远端下载预打包的「语言服务捆绑包」zip（内含便携 Node 与两个 language server），
//!    sha256 校验后解压到应用数据目录（app_data_dir/language-servers/），供 LSP 子进程直接使用。
//! 2. 提供多镜像源（GitHub Release / 加速镜像 / 自定义）与自动降级，兼容国内网络。
//!
//! 安装位置刻意不使用「安装目录」：macOS 上写入 App bundle 会破坏代码签名，
//! 且 Tauri updater 整体替换 bundle 会清掉安装产物；应用数据目录与既有
//! ~/.mirocode 凭据体系同域，安全且持久。
//!
//! 产物结构（由 scripts/language-servers 打包生成）：
//! ```text
//! zip/
//!   manifest.json            # { version, nodeVersion, platform, entries: {ts, vue} }
//!   node/                    # 便携 Node 运行时（node / node.exe）
//!   node_modules/            # typescript-language-server / typescript / @vue/language-server
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

/// 语言服务目录名（位于 app_data_dir 下）
const LS_DIR_NAME: &str = "language-servers";

/// 远端版本清单文件名（发布在镜像源根目录）
const LS_MANIFEST_NAME: &str = "ls-latest.json";

/// 本地安装记录文件名（记录当前激活版本）
const LS_INSTALLED_NAME: &str = "installed.json";

/// 官方源：GitHub Release 固定 tag `language-servers`（每次发布覆盖更新该 Release）
const GITHUB_BASE: &str =
    "https://github.com/yqstart/MiroCode/releases/download/language-servers";

/// 国内加速镜像：ghproxy 类通用 GitHub 下载加速
const GHPROXY_BASE: &str =
    "https://ghfast.top/https://github.com/yqstart/MiroCode/releases/download/language-servers";

/// 安装/卸载互斥锁（避免并发安装造成目录竞争；tokio Mutex 保证 async 内 Send）
static LS_OPS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn ls_ops_lock() -> &'static Mutex<()> {
    LS_OPS_LOCK.get_or_init(|| Mutex::new(()))
}

// ==================== 类型 ====================

/// 远端版本清单（ls-latest.json）
#[derive(Debug, Clone, Deserialize)]
struct RemoteManifest {
    /// 捆绑包版本（如 "0.1.0"）
    version: String,
    /// 平台标识 -> 产物信息
    platforms: HashMap<String, PlatformAsset>,
}

/// 单个平台的产物信息
#[derive(Debug, Clone, Deserialize)]
struct PlatformAsset {
    /// 相对文件名（应用端拼镜像源 base）
    url: String,
    /// sha256 十六进制
    sha256: String,
}

/// 捆绑包内部 manifest.json（打包时生成）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    version: String,
    /// Node 运行时版本（展示用，当前未读）
    #[allow(dead_code)]
    node_version: String,
    /// 打包平台标识（展示/排查用，当前未读）
    #[allow(dead_code)]
    platform: String,
    /// server 类型 -> node_modules 内相对入口
    entries: HashMap<String, String>,
}

/// 本地安装记录
#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledRecord {
    version: String,
    installed_at: String,
}

/// ls_status 返回：本地安装版本 + 远端最新版本（离线时 latest 为 null）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LsStatus {
    /// 当前平台是否有可用产物（决定「一键安装」按钮是否可用）
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

/// 本地安装记录路径
fn installed_path(root: &Path) -> PathBuf {
    root.join(LS_INSTALLED_NAME)
}

/// 版本目录路径：<root>/<version>
fn version_dir(root: &Path, version: &str) -> PathBuf {
    root.join(version)
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
        Err("当前平台暂不支持内置语言服务".into())
    }
}

// ==================== 本地状态读写 ====================

fn read_installed(root: &Path) -> Option<InstalledRecord> {
    let raw = std::fs::read_to_string(installed_path(root)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_installed(root: &Path, record: &InstalledRecord) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    let path = installed_path(root);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("写入安装记录失败: {e}"))
}

/// 读取当前激活 bundle 的运行时信息（供 lsp.rs 启动子进程）
///
/// 返回 node 可执行文件绝对路径与两个 server 的入口绝对路径。
/// 未安装 / 记录损坏 / 目录缺失时返回 None（调用方回退 npx 流程）。
pub struct BundledRuntime {
    pub version: String,
    pub node_path: PathBuf,
    pub ts_entry: PathBuf,
    pub vue_entry: PathBuf,
}

/// 解析当前激活的捆绑包运行时；失败返回 None（不阻塞 LSP 回退）
pub fn bundled_runtime(app: &AppHandle) -> Option<BundledRuntime> {
    let root = ls_root(app).ok()?;
    let record = read_installed(&root)?;
    let dir = version_dir(&root, &record.version);
    if !dir.is_dir() {
        return None;
    }
    resolve_bundle_dir(&dir)
}

/// 解析捆绑包目录，返回运行时信息（node 路径 + 两个 server 入口）
///
/// 纯路径解析（不依赖 AppHandle），便于单元测试：
/// - 目录存在 manifest.json（BundleManifest）
/// - node 可执行文件：Windows 为 node/node.exe，Unix 为 node/bin/node
/// - entries 指向的 JS 入口存在
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
        .find(|p| p.exists())?;

    let ts_entry = dir.join(bundle.entries.get("ts")?);
    let vue_entry = dir.join(bundle.entries.get("vue")?);
    if !ts_entry.exists() || !vue_entry.exists() {
        return None;
    }

    Some(BundledRuntime {
        version: bundle.version,
        node_path,
        ts_entry,
        vue_entry,
    })
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

    let total = resp.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("创建临时文件失败: {e}"))?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        received += chunk.len() as u64;
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

/// 计算文件 sha256（十六进制小写）
fn sha256_hex(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("读取下载文件失败: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
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
            let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 删除目录（忽略错误，尽力清理）
fn remove_dir_if_exists(path: &Path) {
    if path.exists() {
        let _ = std::fs::remove_dir_all(path);
    }
}

/// 清理旧版本：保留指定版本，其余版本目录全部删除
fn prune_old_versions(root: &Path, keep_version: &str) {
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue; // .tmp / 隐藏目录
            }
            if name != keep_version && entry.path().is_dir() {
                remove_dir_if_exists(&entry.path());
            }
        }
    }
}

// ==================== 命令 ====================

/// 查询语言服务状态：本地安装版本 + 远端最新版本（顺带做镜像连通性探测）
#[tauri::command]
pub async fn ls_status(
    app: AppHandle,
    mirror: String,
    custom_base: Option<String>,
) -> Result<LsStatus, String> {
    let root = ls_root(&app)?;
    let supported = platform_key().is_ok();

    // 本地安装版本
    let installed_version = read_installed(&root).map(|r| r.version);
    if let Some(v) = &installed_version {
        // 记录存在但目录缺失时视为未安装
        if !version_dir(&root, v).is_dir() {
            let _ = std::fs::remove_file(installed_path(&root));
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
                .platforms
                .get(platform_key().unwrap_or_default())
                .map(|_| manifest.version.clone());
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

/// 一键安装 / 更新语言服务捆绑包
///
/// 流程：拉版本清单 → 流式下载 zip（进度事件）→ sha256 校验 → 解压 → 激活新版本 → 清理旧版本。
/// 已安装同版本时幂等直接返回。
#[tauri::command]
pub async fn ls_install(
    app: AppHandle,
    mirror: String,
    custom_base: Option<String>,
) -> Result<String, String> {
    let _guard = ls_ops_lock().lock().await;

    let root = ls_root(&app)?;
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

    let asset = manifest
        .platforms
        .get(platform)
        .cloned()
        .ok_or_else(|| format!("当前平台 {platform} 暂未发布语言服务捆绑包"))?;

    // 幂等：已安装同版本直接返回
    if let Some(cur) = read_installed(&root) {
        if cur.version == manifest.version && version_dir(&root, &manifest.version).is_dir() {
            return Ok(manifest.version);
        }
    }

    // 2. 流式下载
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let tmp_dir = root.join(".tmp");
    remove_dir_if_exists(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let zip_path = tmp_dir.join(format!(
        "language-servers-{}-{}.zip",
        manifest.version, platform
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
    let unpack_dir = tmp_dir.join(&manifest.version);
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
    if bundle.version != manifest.version {
        remove_dir_if_exists(&tmp_dir);
        return Err(format!(
            "捆绑包版本不匹配（期望 {}，实际 {}）",
            manifest.version, bundle.version
        ));
    }

    let final_dir = version_dir(&root, &manifest.version);
    if final_dir.exists() {
        remove_dir_if_exists(&final_dir);
    }
    std::fs::rename(&unpack_dir, &final_dir).map_err(|e| format!("激活新版本失败: {e}"))?;

    // 5. 记录激活版本 + 清理旧版本与临时文件
    write_installed(
        &root,
        &InstalledRecord {
            version: manifest.version.clone(),
            installed_at: chrono::Local::now().to_rfc3339(),
        },
    )?;
    prune_old_versions(&root, &manifest.version);
    remove_dir_if_exists(&tmp_dir);

    emit("done", 0, 0, 100.0, "");
    Ok(manifest.version)
}

/// 卸载语言服务捆绑包（删除版本目录与安装记录）
#[tauri::command]
pub async fn ls_uninstall(app: AppHandle) -> Result<(), String> {
    let _guard = ls_ops_lock().lock().await;

    let root = ls_root(&app)?;
    if let Some(record) = read_installed(&root) {
        remove_dir_if_exists(&version_dir(&root, &record.version));
    }
    let _ = std::fs::remove_file(installed_path(&root));
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

    /// 构造一个结构完整的假 bundle 目录（与打包脚本产物结构一致）
    fn make_fake_bundle(dir: &std::path::Path) {
        // node 可执行文件（Unix 结构 node/bin/node；Windows 结构 node/node.exe）
        if cfg!(target_os = "windows") {
            std::fs::create_dir_all(dir.join("node")).unwrap();
            std::fs::write(dir.join("node/node.exe"), b"fake").unwrap();
        } else {
            std::fs::create_dir_all(dir.join("node/bin")).unwrap();
            std::fs::write(dir.join("node/bin/node"), b"#!/bin/sh\nexit 0\n").unwrap();
        }
        // 两个 server 入口
        let ts = dir.join("node_modules/typescript-language-server/lib/node.js");
        std::fs::create_dir_all(ts.parent().unwrap()).unwrap();
        std::fs::write(&ts, b"// fake\n").unwrap();
        let vue = dir.join("node_modules/@vue/language-server/bin/vue-language-server.js");
        std::fs::create_dir_all(vue.parent().unwrap()).unwrap();
        std::fs::write(&vue, b"// fake\n").unwrap();
        // manifest.json
        std::fs::write(
            dir.join("manifest.json"),
            serde_json::json!({
                "version": "0.1.0",
                "nodeVersion": "22.14.0",
                "platform": "darwin-arm64",
                "entries": {
                    "ts": "node_modules/typescript-language-server/lib/node.js",
                    "vue": "node_modules/@vue/language-server/bin/vue-language-server.js"
                }
            })
            .to_string(),
        )
        .unwrap();
    }

    #[test]
    fn test_resolve_bundle_dir_valid() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path());

        let rt = resolve_bundle_dir(dir.path()).expect("应能解析合法 bundle");
        assert_eq!(rt.version, "0.1.0");
        if cfg!(target_os = "windows") {
            assert_eq!(rt.node_path, dir.path().join("node/node.exe"));
        } else {
            assert_eq!(rt.node_path, dir.path().join("node/bin/node"));
        }
        assert!(rt.ts_entry.ends_with("typescript-language-server/lib/node.js"));
        assert!(rt.vue_entry.ends_with("vue-language-server.js"));
    }

    #[test]
    fn test_resolve_bundle_dir_missing_manifest() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path());
        std::fs::remove_file(dir.path().join("manifest.json")).unwrap();
        assert!(resolve_bundle_dir(dir.path()).is_none());
    }

    #[test]
    fn test_resolve_bundle_dir_missing_entry() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path());
        // 删除 vue 入口文件
        std::fs::remove_dir_all(
            dir.path().join("node_modules/@vue/language-server"),
        )
        .unwrap();
        assert!(resolve_bundle_dir(dir.path()).is_none());
    }

    #[test]
    fn test_resolve_bundle_dir_missing_node() {
        let dir = tempfile::tempdir().unwrap();
        make_fake_bundle(dir.path());
        std::fs::remove_dir_all(dir.path().join("node")).unwrap();
        assert!(resolve_bundle_dir(dir.path()).is_none());
    }
}
