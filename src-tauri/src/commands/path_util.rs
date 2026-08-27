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

/// 将工作区内的绝对/相对路径解析为可用于实际文件操作的绝对路径，
/// 同时拒绝父目录穿越和指向工作区外的符号链接。
pub fn resolve_inside_workspace(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| format!("工作区无效: {e}"))?;
    // 相对路径按工作区根解析；调用方既有绝对路径，也有
    // package.json 这类仓库相对路径。
    let target = if target.is_absolute() {
        target.to_path_buf()
    } else {
        root.join(target)
    };

    if target
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("路径包含非法组件".into());
    }

    if target.exists() {
        let target_canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
        if !target_canon.starts_with(&root) {
            return Err("禁止访问工作区外的路径".into());
        }
        return Ok(target);
    }

    // 目标可能是 Git 状态中的已删除文件，父目录也可能同时被删除。
    // 只向上找到最近的现存祖先再 canonicalize，不能直接 canonicalize
    // target.parent()，否则批量回滚会把正常的缺失路径误报为 os error 2。
    let mut existing = target.as_path();
    loop {
        match fs::symlink_metadata(existing) {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                existing = existing
                    .parent()
                    .ok_or_else(|| "无效目标路径".to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    let existing_canon = fs::canonicalize(existing).map_err(|e| e.to_string())?;
    if !existing_canon.starts_with(&root) {
        return Err("禁止访问工作区外的路径".into());
    }
    Ok(target)
}

pub fn ensure_inside_workspace(root: &Path, target: &Path) -> Result<(), String> {
    resolve_inside_workspace(root, target).map(|_| ())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_inside_workspace_accepts_missing_nested_target() {
        let temp = tempfile::tempdir().expect("创建临时目录");
        let root = temp.path().join("repo");
        fs::create_dir_all(&root).expect("创建工作区");

        let target = root.join("removed").join("file.txt");
        assert!(ensure_inside_workspace(&root, &target).is_ok());
    }

    #[test]
    fn ensure_inside_workspace_rejects_parent_traversal() {
        let temp = tempfile::tempdir().expect("创建临时目录");
        let root = temp.path().join("repo");
        fs::create_dir_all(&root).expect("创建工作区");

        let target = root.join("..").join("outside.txt");
        let error = ensure_inside_workspace(&root, &target).expect_err("应拒绝工作区外路径");
        assert!(error.contains("路径包含非法组件"));
    }
}
