use chrono::{Local, TimeZone};
use git2::{
    build::CheckoutBuilder, BranchType, Cred, DiffOptions, PushOptions, RemoteCallbacks,
    Repository, ResetType, Signature, StashFlags, StatusOptions,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

fn open_repo(root: &str) -> Result<Repository, String> {
    Repository::discover(root).map_err(|e| format!("未找到 Git 仓库: {e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub initialized: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    /// 本地领先上游的提交数
    pub ahead: usize,
    /// 本地落后上游的提交数
    pub behind: usize,
    pub entries: Vec<GitStatusEntry>,
    pub conflict_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub id: String,
    pub summary: String,
    pub author: String,
    pub time: String,
    pub files: Vec<String>,
    /// 父提交短 id（用于绘制提交图）
    pub parents: Vec<String>,
    /// 指向该提交的本地/远程 refs（短名）
    pub refs: Vec<String>,
    /// 是否尚未推送到上游（位于 ahead 区间内）
    pub unpushed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub path: String,
    pub patch: String,
}

/// 分栏对比两侧文本（WebStorm 风格）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileSides {
    pub path: String,
    pub left: String,
    pub right: String,
    pub left_label: String,
    pub right_label: String,
}

/// 冲突文件三路文本。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictSides {
    pub path: String,
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub working: String,
}

fn status_label(status: git2::Status) -> String {
    if status.is_conflicted() {
        return "conflict".into();
    }
    if status.is_index_new() || status.is_wt_new() {
        return "untracked".into();
    }
    if status.is_index_deleted() || status.is_wt_deleted() {
        return "deleted".into();
    }
    if status.is_index_renamed() || status.is_wt_renamed() {
        return "renamed".into();
    }
    if status.is_index_modified() || status.is_wt_modified() || status.is_wt_typechange() {
        return "modified".into();
    }
    "changed".into()
}

#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatusSnapshot, String> {
    let path = PathBuf::from(&root);
    let repo = match Repository::discover(&path) {
        Ok(r) => r,
        Err(_) => {
            return Ok(GitStatusSnapshot {
                initialized: false,
                branch: None,
                upstream: None,
                ahead: 0,
                behind: 0,
                entries: vec![],
                conflict_count: 0,
            });
        }
    };

    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(|s| s.to_string()));

    let upstream = (|| {
        let head = repo.head().ok()?;
        if !head.is_branch() {
            return None;
        }
        let name = head.shorthand().ok()?;
        let branch = repo.find_branch(name, BranchType::Local).ok()?;
        let up = branch.upstream().ok()?;
        up.name().ok().flatten().map(|s| s.to_string())
    })();

    let (ahead, behind) = (|| {
        let head = repo.head().ok()?;
        if !head.is_branch() {
            return None;
        }
        let name = head.shorthand().ok()?;
        let branch = repo.find_branch(name, BranchType::Local).ok()?;
        let local_oid = head.target()?;
        let upstream_ref = branch.upstream().ok()?;
        let remote_oid = upstream_ref.get().target()?;
        repo.graph_ahead_behind(local_oid, remote_oid).ok()
    })()
    .unwrap_or((0, 0));

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .exclude_submodules(true)
        .renames_head_to_index(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut conflict_count = 0usize;

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        let st = entry.status();
        let conflicted = st.is_conflicted();
        if conflicted {
            conflict_count += 1;
        }
        let staged = st.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        );
        let unstaged = st.intersects(
            git2::Status::WT_NEW
                | git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED
                | git2::Status::WT_TYPECHANGE
                | git2::Status::CONFLICTED,
        );
        entries.push(GitStatusEntry {
            path,
            status: status_label(st),
            staged,
            unstaged,
            conflicted,
        });
    }

    Ok(GitStatusSnapshot {
        initialized: true,
        branch: head_name,
        upstream,
        ahead,
        behind,
        entries,
        conflict_count,
    })
}

#[tauri::command]
pub fn git_init(root: String) -> Result<(), String> {
    Repository::init(&root).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_set_remote(root: String, name: String, url: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    match repo.find_remote(&name) {
        Ok(_) => repo.remote_set_url(&name, &url).map_err(|e| e.to_string())?,
        Err(_) => {
            repo.remote(&name, &url).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn index_add(repo: &Repository, paths: &[String]) -> Result<(), String> {
    let mut index = repo.index().map_err(|e| e.to_string())?;
    if paths.is_empty() {
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| e.to_string())?;
    } else {
        for p in paths {
            let abs = repo.workdir().map(|w| w.join(p));
            if abs.as_ref().map(|a| a.is_dir()).unwrap_or(false) {
                index
                    .add_all([p.as_str()].iter(), git2::IndexAddOption::DEFAULT, None)
                    .map_err(|e| e.to_string())?;
            } else if abs.as_ref().map(|a| a.exists()).unwrap_or(false) {
                index.add_path(Path::new(p)).map_err(|e| e.to_string())?;
            } else {
                let _ = index.remove_path(Path::new(p));
            }
        }
    }
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&root)?;
    index_add(&repo, &paths)
}

#[tauri::command]
pub fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&root)?;
    match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
            if paths.is_empty() {
                repo.reset(commit.as_object(), ResetType::Mixed, None)
                    .map_err(|e| e.to_string())?;
            } else {
                repo.reset_default(Some(commit.as_object()), &paths)
                    .map_err(|e| e.to_string())?;
            }
        }
        Err(_) => {
            let mut index = repo.index().map_err(|e| e.to_string())?;
            if paths.is_empty() {
                index.clear().map_err(|e| e.to_string())?;
            } else {
                for p in paths {
                    let _ = index.remove_path(Path::new(&p));
                }
            }
            index.write().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(root: String, message: String, paths: Option<Vec<String>>) -> Result<String, String> {
    let repo = open_repo(&root)?;
    if message.trim().is_empty() {
        return Err("提交说明不能为空".into());
    }
    if let Some(paths) = paths {
        if !paths.is_empty() {
            index_add(&repo, &paths)?;
        }
    }

    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Miro Code", "mirocode@local"))
        .map_err(|e| e.to_string())?;

    let parents = match repo.head() {
        Ok(head) => vec![head.peel_to_commit().map_err(|e| e.to_string())?],
        Err(_) => vec![],
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let oid = repo
        .commit(
            Some("HEAD"),
            &sig,
            &sig,
            message.trim(),
            &tree,
            &parent_refs,
        )
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

#[tauri::command]
pub fn git_branches(root: String) -> Result<Vec<GitBranchInfo>, String> {
    let repo = open_repo(&root)?;
    let mut list = Vec::new();
    let branches = repo.branches(None).map_err(|e| e.to_string())?;
    for item in branches {
        let (branch, ty) = item.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));
        list.push(GitBranchInfo {
            name,
            is_head: branch.is_head(),
            is_remote: matches!(ty, BranchType::Remote),
            upstream,
        });
    }
    list.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(list)
}

#[tauri::command]
pub fn git_checkout(root: String, name: String, force: Option<bool>) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let (object, reference) = repo.revparse_ext(&name).map_err(|e| e.to_string())?;
    let mut builder = CheckoutBuilder::new();
    if force.unwrap_or(false) {
        builder.force();
    }
    repo.checkout_tree(&object, Some(&mut builder))
        .map_err(|e| format!("切换分支失败: {e}"))?;
    match reference {
        Some(r) => {
            let refname = r.name().map_err(|e| e.to_string())?;
            repo.set_head(refname).map_err(|e| e.to_string())?;
        }
        None => {
            repo.set_head_detached(object.id())
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(root: String, name: String, checkout: bool) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let commit = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    repo.branch(&name, &commit, false)
        .map_err(|e| e.to_string())?;
    if checkout {
        git_checkout(root, name, Some(false))?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_delete_branch(root: String, name: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let mut branch = repo
        .find_branch(&name, BranchType::Local)
        .map_err(|e| e.to_string())?;
    if branch.is_head() {
        return Err("不能删除当前分支".into());
    }
    branch.delete().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_rename_branch(root: String, from: String, to: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let mut branch = repo
        .find_branch(&from, BranchType::Local)
        .map_err(|e| e.to_string())?;
    branch.rename(&to, false).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_log(root: String, limit: Option<usize>) -> Result<Vec<GitCommitInfo>, String> {
    let repo = open_repo(&root)?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    // TOPOLOGICAL 便于绘制父子关系图；TIME 作次要排序
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);

    // 收集 ref → commit 短 id 映射
    let mut ref_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    if let Ok(refs) = repo.references() {
        for reference in refs.flatten() {
            let Ok(name) = reference.shorthand() else {
                continue;
            };
            if name == "HEAD" {
                continue;
            }
            if let Some(oid) = reference.target() {
                let id = oid.to_string();
                let short = id[..7.min(id.len())].to_string();
                ref_map.entry(short).or_default().push(name.to_string());
            }
        }
    }

    // ahead 区间：本地有、上游没有的提交
    let mut unpushed_ids = std::collections::HashSet::new();
    if let Ok(head) = repo.head() {
        if head.is_branch() {
            if let Ok(branch_name) = head.shorthand() {
                if let Ok(branch) = repo.find_branch(branch_name, BranchType::Local) {
                    if let Ok(upstream) = branch.upstream() {
                        if let (Some(local), Some(remote)) =
                            (head.target(), upstream.get().target())
                        {
                            if let Ok(mut walk) = repo.revwalk() {
                                let _ = walk.push(local);
                                let _ = walk.hide(remote);
                                for oid in walk.flatten() {
                                    let id = oid.to_string();
                                    unpushed_ids.insert(id[..7.min(id.len())].to_string());
                                }
                            }
                        }
                    } else if let Ok(mut walk) = repo.revwalk() {
                        // 无上游：当前可见提交视为未推送
                        let _ = walk.push_head();
                        for (i, oid) in walk.enumerate() {
                            if i >= limit {
                                break;
                            }
                            if let Ok(oid) = oid {
                                let id = oid.to_string();
                                unpushed_ids.insert(id[..7.min(id.len())].to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut commits = Vec::new();
    for (i, oid) in revwalk.enumerate() {
        if i >= limit {
            break;
        }
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let time = Local
            .timestamp_opt(commit.time().seconds(), 0)
            .single()
            .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();

        let mut files = Vec::new();
        if let Ok(parent) = commit.parent(0) {
            if let (Ok(a), Ok(b)) = (parent.tree(), commit.tree()) {
                if let Ok(diff) = repo.diff_tree_to_tree(Some(&a), Some(&b), None) {
                    let _ = diff.foreach(
                        &mut |delta, _| {
                            if let Some(path) =
                                delta.new_file().path().or_else(|| delta.old_file().path())
                            {
                                files.push(path.to_string_lossy().to_string());
                            }
                            true
                        },
                        None,
                        None,
                        None,
                    );
                }
            }
        }

        let id = oid.to_string();
        let short = id[..7.min(id.len())].to_string();
        let parents: Vec<String> = (0..commit.parent_count())
            .filter_map(|i| commit.parent_id(i).ok())
            .map(|pid| {
                let s = pid.to_string();
                s[..7.min(s.len())].to_string()
            })
            .collect();
        let refs = ref_map.get(&short).cloned().unwrap_or_default();
        let unpushed = unpushed_ids.contains(&short);

        commits.push(GitCommitInfo {
            id: short,
            summary: commit
                .summary()
                .ok()
                .flatten()
                .unwrap_or("")
                .to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            time,
            files,
            parents,
            refs,
            unpushed,
        });
    }
    Ok(commits)
}

/// 丢弃工作区指定路径的未提交变更（已跟踪还原到 HEAD；未跟踪则删除）。
#[tauri::command]
pub fn git_discard_paths(root: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let repo = open_repo(&root)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "裸仓库无法丢弃工作区变更".to_string())?
        .to_path_buf();

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .exclude_submodules(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let path_set: std::collections::HashSet<&str> =
        paths.iter().map(|p| p.as_str()).collect();
    let mut tracked: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("");
        if path.is_empty() || !path_set.contains(path) {
            continue;
        }
        let st = entry.status();
        // 纯未跟踪（工作区新增且未入 index）→ 删除文件
        if st.is_wt_new() && !st.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        ) {
            untracked.push(path.to_string());
        } else {
            tracked.push(path.to_string());
        }
    }

    if !tracked.is_empty() {
        let mut builder = CheckoutBuilder::new();
        builder.force();
        for path in &tracked {
            builder.path(path);
        }
        // checkout_head 会把指定路径的 index + worktree 一并还原到 HEAD
        repo.checkout_head(Some(&mut builder))
            .map_err(|e| format!("丢弃变更失败: {e}"))?;

        // INDEX_NEW（已暂存但从未提交）在 HEAD 中不存在，需从 index 移除并删工作区文件
        let mut index = repo.index().map_err(|e| e.to_string())?;
        let head_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok());
        for path in &tracked {
            let in_head = head_tree
                .as_ref()
                .and_then(|t| t.get_path(Path::new(path)).ok())
                .is_some();
            if !in_head {
                let _ = index.remove_path(Path::new(path));
                let full = workdir.join(path);
                if full.is_dir() {
                    let _ = std::fs::remove_dir_all(&full);
                } else if full.exists() {
                    let _ = std::fs::remove_file(&full);
                }
            }
        }
        index.write().map_err(|e| e.to_string())?;
    }

    for path in &untracked {
        let full = workdir.join(path);
        if full.is_dir() {
            std::fs::remove_dir_all(&full)
                .map_err(|e| format!("删除未跟踪目录失败 {}: {e}", full.display()))?;
        } else if full.exists() {
            std::fs::remove_file(&full)
                .map_err(|e| format!("删除未跟踪文件失败 {}: {e}", full.display()))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn git_diff(
    root: String,
    path: Option<String>,
    staged: Option<bool>,
) -> Result<GitDiffResult, String> {
    let repo = open_repo(&root)?;
    let staged = staged.unwrap_or(false);
    let mut opts = DiffOptions::new();
    if let Some(ref p) = path {
        opts.pathspec(p);
    }
    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
            .map_err(|e| e.to_string())?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
            .map_err(|e| e.to_string())?
    };

    let mut patch = String::new();
    let stats = diff.stats().map_err(|e| e.to_string())?;
    patch.push_str(&format!(
        "files: {}  +{}  -{}\n\n",
        stats.files_changed(),
        stats.insertions(),
        stats.deletions()
    ));

    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            patch.push(origin);
        }
        patch.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })
    .map_err(|e| e.to_string())?;

    Ok(GitDiffResult {
        path: path.unwrap_or_else(|| "工作区".into()),
        patch,
    })
}

fn blob_text(repo: &Repository, id: git2::Oid) -> Result<String, String> {
    let blob = repo.find_blob(id).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

fn head_file_text(repo: &Repository, path: &str) -> Result<String, String> {
    let Ok(head) = repo.head() else {
        return Ok(String::new());
    };
    let Ok(tree) = head.peel_to_tree() else {
        return Ok(String::new());
    };
    match tree.get_path(Path::new(path)) {
        Ok(entry) => {
            let obj = entry.to_object(repo).map_err(|e| e.to_string())?;
            let blob = obj.peel_to_blob().map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(blob.content()).to_string())
        }
        Err(_) => Ok(String::new()),
    }
}

fn index_file_text(repo: &Repository, path: &str) -> Result<String, String> {
    let index = repo.index().map_err(|e| e.to_string())?;
    match index.get_path(Path::new(path), 0) {
        Some(entry) => blob_text(repo, entry.id),
        None => Ok(String::new()),
    }
}

fn workdir_file_text(repo: &Repository, path: &str) -> Result<String, String> {
    let wd = repo.workdir().ok_or("无工作区")?;
    let full = wd.join(path);
    if !full.exists() {
        return Ok(String::new());
    }
    if full.is_dir() {
        return Err("目标是目录，无法对比".into());
    }
    std::fs::read_to_string(&full).map_err(|e| format!("读取工作区文件失败: {e}"))
}

/// 分栏 diff：staged=true → HEAD|Index；否则 Index|工作区。
#[tauri::command]
pub fn git_file_sides(
    root: String,
    path: String,
    staged: Option<bool>,
) -> Result<GitFileSides, String> {
    if path.trim().is_empty() {
        return Err("请选择具体文件进行分栏对比".into());
    }
    let repo = open_repo(&root)?;
    let staged = staged.unwrap_or(false);
    if staged {
        Ok(GitFileSides {
            path: path.clone(),
            left: head_file_text(&repo, &path)?,
            right: index_file_text(&repo, &path)?,
            left_label: "HEAD".into(),
            right_label: "已暂存".into(),
        })
    } else {
        let left = {
            let indexed = index_file_text(&repo, &path)?;
            if indexed.is_empty() {
                head_file_text(&repo, &path)?
            } else {
                indexed
            }
        };
        Ok(GitFileSides {
            path: path.clone(),
            left,
            right: workdir_file_text(&repo, &path)?,
            left_label: "索引".into(),
            right_label: "工作区".into(),
        })
    }
}

/// 冲突分栏：ours / theirs / base / working。
#[tauri::command]
pub fn git_conflict_sides(root: String, path: String) -> Result<GitConflictSides, String> {
    if path.trim().is_empty() {
        return Err("路径不能为空".into());
    }
    let repo = open_repo(&root)?;
    let index = repo.index().map_err(|e| e.to_string())?;
    let conflict = index
        .conflict_get(Path::new(&path))
        .map_err(|e| format!("不是冲突文件或无法读取: {e}"))?;

    let base = match conflict.ancestor {
        Some(e) => blob_text(&repo, e.id)?,
        None => String::new(),
    };
    let ours = match conflict.our {
        Some(e) => blob_text(&repo, e.id)?,
        None => String::new(),
    };
    let theirs = match conflict.their {
        Some(e) => blob_text(&repo, e.id)?,
        None => String::new(),
    };
    let working = workdir_file_text(&repo, &path)?;

    Ok(GitConflictSides {
        path,
        base,
        ours,
        theirs,
        working,
    })
}

fn make_callbacks() -> RemoteCallbacks<'static> {
    let mut cb = RemoteCallbacks::new();
    cb.credentials(|_url, username_from_url, allowed| {
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            return Cred::ssh_key_from_agent(user);
        }
        Cred::default()
    });
    cb
}

#[tauri::command]
pub fn git_pull(root: String) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().map_err(|e| e.to_string())?.to_string();
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("缺少 origin 远程: {e}"))?;
    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(make_callbacks());
    remote
        .fetch(&[branch.as_str()], Some(&mut opts), None)
        .map_err(|e| format!("拉取失败: {e}"))?;

    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;

    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;
    if analysis.is_up_to_date() {
        return Ok("已是最新".into());
    }
    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{branch}");
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference
            .set_target(fetch_commit.id(), "fast-forward")
            .map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
        return Ok("快进合并完成".into());
    }

    repo.merge(&[&fetch_commit], None, None)
        .map_err(|e| format!("合并失败: {e}"))?;
    if repo.index().map(|i| i.has_conflicts()).unwrap_or(false) {
        return Err("拉取后存在冲突，请在 Git 面板解决".into());
    }
    let msg = format!("Merge remote-tracking branch 'origin/{branch}'");
    git_commit(root, msg, None)?;
    Ok("合并拉取完成".into())
}

#[tauri::command]
pub fn git_push(root: String, force: Option<bool>) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().map_err(|e| e.to_string())?.to_string();
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("缺少 origin 远程: {e}"))?;
    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(make_callbacks());
    let refspec = if force.unwrap_or(false) {
        format!("+refs/heads/{branch}:refs/heads/{branch}")
    } else {
        format!("refs/heads/{branch}:refs/heads/{branch}")
    };
    remote
        .push(&[refspec.as_str()], Some(&mut push_opts))
        .map_err(|e| format!("推送失败: {e}"))?;
    Ok("推送成功".into())
}

#[tauri::command]
pub fn git_stash(
    root: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let msg = message.unwrap_or_else(|| "Miro Code stash".into());
    let flags = if include_untracked.unwrap_or(false) {
        StashFlags::INCLUDE_UNTRACKED
    } else {
        StashFlags::DEFAULT
    };
    repo.stash_save(&sig, &msg, Some(flags))
        .map_err(|e| format!("贮藏失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn git_stash_pop(root: String) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    repo.stash_pop(0, None).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_reset_hard(root: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let head = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    repo.reset(head.as_object(), ResetType::Hard, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_undo_commit(root: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let commit = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    if commit.parent_count() == 0 {
        return Err("没有可撤销的父提交".into());
    }
    let parent = commit.parent(0).map_err(|e| e.to_string())?;
    repo.reset(parent.as_object(), ResetType::Soft, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_revert_to(root: String, commit_id: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    repo.reset(commit.as_object(), ResetType::Hard, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_merge_branch(root: String, name: String) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let branch = repo
        .find_branch(&name, BranchType::Local)
        .or_else(|_| repo.find_branch(&format!("origin/{name}"), BranchType::Remote))
        .map_err(|e| e.to_string())?;
    let commit = branch.get().peel_to_commit().map_err(|e| e.to_string())?;
    let annotated = repo
        .find_annotated_commit(commit.id())
        .map_err(|e| e.to_string())?;
    let (analysis, _) = repo
        .merge_analysis(&[&annotated])
        .map_err(|e| e.to_string())?;
    if analysis.is_up_to_date() {
        return Ok("已是最新，无需合并".into());
    }
    if analysis.is_fast_forward() {
        let head_ref = repo.head().map_err(|e| e.to_string())?;
        let refname = head_ref.name().map_err(|e| e.to_string())?.to_string();
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference
            .set_target(annotated.id(), "merge fast-forward")
            .map_err(|e| e.to_string())?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
        return Ok("快进合并完成".into());
    }
    repo.merge(&[&annotated], None, None)
        .map_err(|e| e.to_string())?;
    if repo.index().map(|i| i.has_conflicts()).unwrap_or(false) {
        return Err("合并产生冲突，请在冲突面板解决".into());
    }
    git_commit(root, format!("Merge branch '{name}'"), None)?;
    Ok("合并完成".into())
}

#[tauri::command]
pub fn git_conflict_files(root: String) -> Result<Vec<String>, String> {
    let snapshot = git_status(root)?;
    Ok(snapshot
        .entries
        .into_iter()
        .filter(|e| e.conflicted)
        .map(|e| e.path)
        .collect())
}

#[tauri::command]
pub fn git_resolve_conflict(root: String, path: String, strategy: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let wd = repo.workdir().ok_or("无工作区")?.to_path_buf();
    let full = wd.join(&path);

    match strategy.as_str() {
        "ours" | "theirs" => {
            let index = repo.index().map_err(|e| e.to_string())?;
            let conflict = index
                .conflict_get(Path::new(&path))
                .map_err(|e| e.to_string())?;
            let chosen = if strategy == "ours" {
                conflict.our
            } else {
                conflict.their
            };
            let Some(entry) = chosen else {
                return Err("无法获取冲突版本".into());
            };
            let blob = repo.find_blob(entry.id).map_err(|e| e.to_string())?;
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&full, blob.content()).map_err(|e| e.to_string())?;
        }
        "manual" => {}
        _ => return Err("未知解决策略".into()),
    }

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_path(Path::new(&path))
        .map_err(|e| e.to_string())?;
    let _ = index.conflict_remove(Path::new(&path));
    index.write().map_err(|e| e.to_string())?;
    Ok(())
}
