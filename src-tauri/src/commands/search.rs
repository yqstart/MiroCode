use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::path_util::{ensure_inside_workspace, walk_files};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchHit {
    pub path: String,
    pub name: String,
    pub relative: String,
    pub score: i32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    pub path: String,
    pub relative: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub changed_files: usize,
    pub replacements: usize,
    pub files: Vec<String>,
}

/// 仅当文件名或任一路径段（文件夹名）包含查询子串时命中；不做跨段子序列模糊。
fn segment_contains_score(query: &str, name: &str, relative: &str) -> Option<i32> {
    let q = query.to_lowercase();
    if q.is_empty() {
        return None;
    }

    let name_lc = name.to_lowercase();
    if name_lc.contains(&q) {
        let bonus = if name_lc.starts_with(&q) { 40 } else { 20 };
        return Some(200 + bonus - (name_lc.len() as i32).min(80));
    }

    let segments: Vec<&str> = relative
        .split(['/', '\\'])
        .filter(|s| !s.is_empty())
        .collect();
    // 排除最后一段（文件名已在上方匹配）
    let folder_count = segments.len().saturating_sub(1);
    for (i, seg) in segments.iter().take(folder_count).enumerate() {
        let seg_lc = seg.to_lowercase();
        if seg_lc.contains(&q) {
            let bonus = if seg_lc.starts_with(&q) { 30 } else { 10 };
            // 越靠近文件名的目录段略加分
            return Some(100 + bonus + (i as i32) * 2 - (seg_lc.len() as i32).min(40));
        }
    }
    None
}

fn match_ext(path: &Path, extensions: &Option<Vec<String>>) -> bool {
    let Some(exts) = extensions else {
        return true;
    };
    if exts.is_empty() {
        return true;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    exts.iter()
        .any(|e| e.trim_start_matches('.').eq_ignore_ascii_case(&ext))
}

/// 文件列表缓存（root + 忽略规则 为 key），避免每次搜索重复全量遍历目录树。
/// 搜索结果天然按最新磁盘状态返回，故不主动失效；工作区切换会改变 root，自动换 key。
struct WalkCache {
    map: HashMap<String, Vec<PathBuf>>,
    order: Vec<String>,
    max: usize,
}

impl WalkCache {
    fn new(max: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: Vec::new(),
            max,
        }
    }

    fn cache_key(root: &str, extra_ignores: &[String]) -> String {
        format!("{root}\u{0}{}", extra_ignores.join("\u{1}"))
    }

    fn get(&mut self, key: &str) -> Option<Vec<PathBuf>> {
        if let Some(files) = self.map.get(key) {
            // 命中即提升为最近使用
            if let Some(pos) = self.order.iter().position(|k| k == key) {
                self.order.remove(pos);
            }
            self.order.push(key.to_string());
            return Some(files.clone());
        }
        None
    }

    fn insert(&mut self, key: String, files: Vec<PathBuf>) {
        self.map.insert(key.clone(), files);
        self.order.push(key);
        while self.order.len() > self.max {
            let lru = self.order.remove(0);
            self.map.remove(&lru);
        }
    }
}

/// 全局文件列表缓存（进程级单例）
fn walk_cache() -> &'static Mutex<WalkCache> {
    static CACHE: std::sync::OnceLock<Mutex<WalkCache>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(WalkCache::new(32)))
}

/// 获取（带缓存的）工作区文件列表。磁盘已变化时结果可能短暂滞后，搜索内容本身始终读最新。
fn cached_walk_files(root: &Path, extra: &[String]) -> Result<Vec<PathBuf>, String> {
    let root_str = root.to_string_lossy().to_string();
    let key = WalkCache::cache_key(&root_str, extra);
    {
        let mut cache = walk_cache().lock().unwrap();
        if let Some(files) = cache.get(&key) {
            return Ok(files);
        }
    }
    let files = walk_files(root, extra)?;
    let mut cache = walk_cache().lock().unwrap();
    cache.insert(key, files.clone());
    Ok(files)
}

/// 在 spawn_blocking 中跑一个同步闭包，带超时（对齐 git 网络命令的防阻塞约定）。
async fn run_blocking<T, F>(timeout_secs: u64, err_prefix: &str, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let handle = tokio::task::spawn_blocking(f);
    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), handle).await {
        Ok(Ok(r)) => r,
        Ok(Err(join)) => Err(format!("{err_prefix}: {join}")),
        Err(_) => Err(format!("{err_prefix}超时（{timeout_secs}s），请重试或缩小范围").into()),
    }
}

#[tauri::command]
pub async fn search_files(
    root: String,
    query: String,
    max_results: Option<usize>,
    extensions: Option<Vec<String>>,
    extra_ignores: Option<Vec<String>>,
) -> Result<Vec<FileSearchHit>, String> {
    let extra = extra_ignores.unwrap_or_default();
    let max = max_results.unwrap_or(80);
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }

    run_blocking(30, "文件搜索", move || {
        let root_path = PathBuf::from(&root);
        ensure_inside_workspace(&root_path, &root_path)?;

        let mut hits = Vec::new();
        for path in cached_walk_files(&root_path, &extra)? {
            if !match_ext(&path, &extensions) {
                continue;
            }
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let relative = path
                .strip_prefix(&root_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string_lossy().to_string());

            let score = segment_contains_score(&q, &name, &relative).unwrap_or(-1);
            if score < 0 {
                continue;
            }
            hits.push(FileSearchHit {
                path: path.to_string_lossy().to_string(),
                name,
                relative,
                score,
            });
        }
        hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.relative.cmp(&b.relative)));
        hits.truncate(max);
        Ok(hits)
    })
    .await
}

#[tauri::command]
pub async fn search_content(
    root: String,
    query: String,
    case_sensitive: Option<bool>,
    max_results: Option<usize>,
    extensions: Option<Vec<String>>,
    extra_ignores: Option<Vec<String>>,
    #[allow(unused_variables)] context_lines: Option<usize>,
) -> Result<Vec<ContentHit>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }
    let case_sensitive = case_sensitive.unwrap_or(false);
    let max = max_results.unwrap_or(500);
    let extra = extra_ignores.unwrap_or_default();
    let query_lc = query.to_lowercase();

    run_blocking(60, "内容搜索", move || {
        let root_path = PathBuf::from(&root);
        ensure_inside_workspace(&root_path, &root_path)?;

        let mut hits = Vec::new();
        for path in cached_walk_files(&root_path, &extra)? {
            if !match_ext(&path, &extensions) {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            if bytes.contains(&0) || bytes.len() > 2_000_000 {
                continue;
            }
            let Ok(text) = String::from_utf8(bytes) else {
                continue;
            };
            let relative = path
                .strip_prefix(&root_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string_lossy().to_string());

            for (idx, line) in text.lines().enumerate() {
                let found = if case_sensitive {
                    line.find(&query)
                } else {
                    line.to_lowercase().find(&query_lc)
                };
                if let Some(col) = found {
                    hits.push(ContentHit {
                        path: path.to_string_lossy().to_string(),
                        relative: relative.clone(),
                        line: idx + 1,
                        column: col + 1,
                        preview: line.trim().chars().take(240).collect(),
                    });
                    if hits.len() >= max {
                        return Ok(hits);
                    }
                }
            }
        }
        Ok(hits)
    })
    .await
}

#[tauri::command]
pub async fn replace_in_files(
    root: String,
    query: String,
    replacement: String,
    case_sensitive: Option<bool>,
    paths: Option<Vec<String>>,
    dry_run: Option<bool>,
    extensions: Option<Vec<String>>,
    extra_ignores: Option<Vec<String>>,
) -> Result<ReplaceResult, String> {
    if query.is_empty() {
        return Err("搜索内容不能为空".into());
    }
    let case_sensitive = case_sensitive.unwrap_or(false);
    let dry_run = dry_run.unwrap_or(true);
    let extra = extra_ignores.unwrap_or_default();

    run_blocking(120, "内容替换", move || {
        let root_path = PathBuf::from(&root);
        ensure_inside_workspace(&root_path, &root_path)?;

        let files: Vec<PathBuf> = if let Some(paths) = paths {
            paths.into_iter().map(PathBuf::from).collect()
        } else {
            cached_walk_files(&root_path, &extra)?
                .into_iter()
                .filter(|p| match_ext(p, &extensions))
                .collect()
        };

        let mut changed_files = 0usize;
        let mut replacements = 0usize;
        let mut touched = Vec::new();

        for path in files {
            ensure_inside_workspace(&root_path, &path)?;
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            if bytes.contains(&0) {
                continue;
            }
            let Ok(text) = String::from_utf8(bytes) else {
                continue;
            };

            let (next, count) = if case_sensitive {
                let count = text.matches(&query).count();
                if count == 0 {
                    continue;
                }
                (text.replace(&query, &replacement), count)
            } else {
                let lower = text.to_lowercase();
                let needle = query.to_lowercase();
                if !lower.contains(&needle) {
                    continue;
                }
                let mut out = String::with_capacity(text.len());
                let mut last = 0usize;
                let mut count = 0usize;
                let mut search_at = 0usize;
                while let Some(rel) = lower[search_at..].find(&needle) {
                    let start = search_at + rel;
                    out.push_str(&text[last..start]);
                    out.push_str(&replacement);
                    last = start + query.len();
                    search_at = last;
                    count += 1;
                }
                out.push_str(&text[last..]);
                (out, count)
            };

            if count == 0 {
                continue;
            }
            changed_files += 1;
            replacements += count;
            touched.push(path.to_string_lossy().to_string());
            if !dry_run {
                fs::write(&path, next).map_err(|e| e.to_string())?;
            }
        }

        Ok(ReplaceResult {
            changed_files,
            replacements,
            files: touched,
        })
    })
    .await
}
