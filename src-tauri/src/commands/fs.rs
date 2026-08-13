use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

use super::path_util::{ensure_inside_workspace, is_tree_ignored, normalize};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn list_dir(
    root: String,
    path: String,
    extra_ignores: Option<Vec<String>>,
) -> Result<Vec<DirEntryInfo>, String> {
    let root_path = PathBuf::from(&root);
    let dir = normalize(&path)?;
    ensure_inside_workspace(&root_path, &dir)?;

    if !dir.is_dir() {
        return Err("目标不是目录".into());
    }

    let extra = extra_ignores.unwrap_or_default();
    let mut entries = Vec::new();

    let rd = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for item in rd {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        if is_tree_ignored(&name, &extra) {
            continue;
        }
        let file_type = item.file_type().map_err(|e| e.to_string())?;
        entries.push(DirEntryInfo {
            name,
            path: item.path().to_string_lossy().to_string(),
            is_dir: file_type.is_dir(),
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_text_file(root: String, path: String) -> Result<String, String> {
    const MAX_BYTES: u64 = 20 * 1024 * 1024; // 20MB（对齐 read_file_base64 的上限策略）
    let root_path = PathBuf::from(&root);
    let file = normalize(&path)?;
    ensure_inside_workspace(&root_path, &file)?;
    if !file.is_file() {
        return Err("目标不是文件".into());
    }
    // 先查元数据，超大文件不整读进内存（避免内存翻倍 + IPC 序列化爆炸）
    let meta = fs::metadata(&file).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err(format!("文件过大，暂不支持打开（上限 {}MB）", MAX_BYTES / 1024 / 1024));
    }
    let bytes = fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Err("暂不支持打开二进制文件".into());
    }
    String::from_utf8(bytes).map_err(|_| "文件不是有效 UTF-8 文本".into())
}

/// 读取工作区内二进制文件为 base64（图片预览）
#[tauri::command]
pub fn read_file_base64(root: String, path: String) -> Result<String, String> {
    const MAX_BYTES: usize = 40 * 1024 * 1024; // 40MB
    let root_path = PathBuf::from(&root);
    let file = normalize(&path)?;
    ensure_inside_workspace(&root_path, &file)?;
    if !file.is_file() {
        return Err("目标不是文件".into());
    }
    let meta = fs::metadata(&file).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_BYTES {
        return Err("图片过大，无法预览（上限 40MB）".into());
    }
    let bytes = fs::read(&file).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_text_file(root: String, path: String, content: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let file = PathBuf::from(&path);
    ensure_inside_workspace(&root_path, &file)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_entry(root: String, path: String, is_dir: bool) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let target = PathBuf::from(&path);
    ensure_inside_workspace(&root_path, &target)?;
    if target.exists() {
        return Err("路径已存在".into());
    }
    if is_dir {
        fs::create_dir_all(&target).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, "").map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn rename_entry(root: String, from: String, to: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let from_path = normalize(&from)?;
    let to_path = PathBuf::from(&to);
    ensure_inside_workspace(&root_path, &from_path)?;
    ensure_inside_workspace(&root_path, &to_path)?;
    if to_path.exists() {
        return Err("目标路径已存在".into());
    }
    fs::rename(&from_path, &to_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_entry(root: String, path: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let target = normalize(&path)?;
    ensure_inside_workspace(&root_path, &target)?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn copy_entry(root: String, from: String, to: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let from_path = normalize(&from)?;
    let to_path = PathBuf::from(&to);
    ensure_inside_workspace(&root_path, &from_path)?;
    ensure_inside_workspace(&root_path, &to_path)?;

    if from_path.is_file() {
        if let Some(parent) = to_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&from_path, &to_path).map_err(|e| e.to_string())?;
        return Ok(());
    }

    if !from_path.is_dir() {
        return Err("不支持的复制源".into());
    }

    for entry in WalkDir::new(&from_path) {
        let entry = entry.map_err(|e| e.to_string())?;
        let rel = entry
            .path()
            .strip_prefix(&from_path)
            .map_err(|e| e.to_string())?;
        let dest = to_path.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(entry.path(), &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn path_exists(root: String, path: String) -> Result<bool, String> {
    let root_path = PathBuf::from(&root);
    let target = PathBuf::from(&path);
    ensure_inside_workspace(&root_path, &target)?;
    Ok(target.exists())
}
