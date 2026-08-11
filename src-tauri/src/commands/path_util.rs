use std::fs;
use std::path::{Component, Path, PathBuf};

/// 搜索/QuickOpen 的忽略名单（影响 walk_files，不影响文件树）
pub const DEFAULT_IGNORES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    ".DS_Store",
    ".next",
    ".vite",
    "coverage",
    ".turbo",
    "out",
];

/// 文件树忽略名单：只隐藏版本控制元数据和系统垃圾文件，
/// node_modules / target / dist / out 等均可见（懒加载，不会一开始就卡）
pub const TREE_IGNORES: &[&str] = &[".git", ".DS_Store"];

pub fn normalize(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("路径必须是绝对路径".into());
    }
    fs::canonicalize(&path).or_else(|_| {
        if let Some(parent) = path.parent() {
            let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
            if let Some(name) = path.file_name() {
                return Ok(parent.join(name));
            }
        }
        Err("无效路径".into())
    })
}

pub fn ensure_inside_workspace(root: &Path, target: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|e| format!("工作区无效: {e}"))?;
    let target_canon = if target.exists() {
        fs::canonicalize(target).map_err(|e| e.to_string())?
    } else {
        let parent = target
            .parent()
            .ok_or_else(|| "无效目标路径".to_string())?;
        let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
        parent.join(target.file_name().ok_or("无效目标路径")?)
    };

    if !target_canon.starts_with(&root) {
        return Err("禁止访问工作区外的路径".into());
    }
    if target.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("路径包含非法组件".into());
    }
    Ok(())
}

pub fn is_ignored_name(name: &str, extra: &[String]) -> bool {
    if name == "." || name == ".." {
        return true;
    }
    if DEFAULT_IGNORES.iter().any(|x| *x == name) {
        return true;
    }
    extra.iter().any(|x| x == name)
}

/// 文件树专用过滤：只跳过 TREE_IGNORES + extra，不做 .gitignore 解析
pub fn is_tree_ignored(name: &str, extra: &[String]) -> bool {
    if name == "." || name == ".." {
        return true;
    }
    if TREE_IGNORES.iter().any(|x| *x == name) {
        return true;
    }
    extra.iter().any(|x| x == name)
}

pub fn walk_files(root: &Path, extra_ignores: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut builder = ignore::WalkBuilder::new(root);
    builder.hidden(false).git_ignore(true).git_global(true);

    let extra = extra_ignores.to_vec();
    builder.filter_entry(move |entry| {
        let name = entry.file_name().to_string_lossy();
        !is_ignored_name(&name, &extra)
    });

    let mut files = Vec::new();
    for entry in builder.build() {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            files.push(entry.into_path());
        }
    }
    Ok(files)
}
