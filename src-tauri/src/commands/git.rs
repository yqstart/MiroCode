use chrono::{Local, TimeZone};
use git2::{
    build::CheckoutBuilder, BranchType, Cred, DiffOptions, PushOptions, RemoteCallbacks,
    Repository, ResetType, Signature, StashFlags, StatusOptions,
};
use serde::{Deserialize, Serialize};
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
    /// 父提交完整 id
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
pub fn git_commit(
    root: String,
    message: String,
    paths: Option<Vec<String>>,
    amend: Option<bool>,
) -> Result<String, String> {
    let repo = open_repo(&root)?;
    if message.trim().is_empty() {
        return Err("提交说明不能为空".into());
    }
    // 勾选路径提交（WebStorm Changelist）：仅纳入选中文件，先重置索引再 add
    if let Some(ref paths) = paths {
        if paths.is_empty() {
            return Err("请至少勾选一个文件再提交".into());
        }
        match repo.head() {
            Ok(head) => {
                let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
                repo.reset(commit.as_object(), ResetType::Mixed, None)
                    .map_err(|e| e.to_string())?;
            }
            Err(_) => {
                let mut index = repo.index().map_err(|e| e.to_string())?;
                index.clear().map_err(|e| e.to_string())?;
                index.write().map_err(|e| e.to_string())?;
            }
        }
        index_add(&repo, paths)?;
    }

    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Miro Code", "mirocode@local"))
        .map_err(|e| e.to_string())?;

    let parents = match repo.head() {
        Ok(head) => {
            let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;
            if amend.unwrap_or(false) {
                let mut ps = Vec::new();
                for i in 0..head_commit.parent_count() {
                    ps.push(head_commit.parent(i).map_err(|e| e.to_string())?);
                }
                ps
            } else {
                vec![head_commit]
            }
        }
        Err(_) => {
            if amend.unwrap_or(false) {
                return Err("没有可修订的提交".into());
            }
            vec![]
        }
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

    // 收集 ref → commit 完整 id 映射
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
                ref_map
                    .entry(oid.to_string())
                    .or_default()
                    .push(name.to_string());
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
                                    unpushed_ids.insert(oid.to_string());
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
                                unpushed_ids.insert(oid.to_string());
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
        let parents: Vec<String> = (0..commit.parent_count())
            .filter_map(|i| commit.parent_id(i).ok())
            .map(|pid| pid.to_string())
            .collect();
        let refs = ref_map.get(&id).cloned().unwrap_or_default();
        let unpushed = unpushed_ids.contains(&id);

        commits.push(GitCommitInfo {
            id,
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

    fn norm(p: &str) -> String {
        p.replace('\\', "/")
    }

    let path_set: std::collections::HashSet<String> =
        paths.iter().map(|p| norm(p)).collect();
    let mut tracked: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("");
        if path.is_empty() {
            continue;
        }
        let key = norm(path);
        if !path_set.contains(&key) {
            continue;
        }
        seen.insert(key.clone());
        let st = entry.status();
        // 纯未跟踪（工作区新增且未入 index）→ 删除文件
        if st.is_wt_new()
            && !st.intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            )
        {
            untracked.push(path.to_string());
        } else {
            tracked.push(path.to_string());
        }
    }

    // 状态列表未命中时仍尝试 checkout（路径格式偶发不一致的兜底）
    for p in &paths {
        let key = norm(p);
        if !seen.contains(&key) {
            tracked.push(p.clone());
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
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
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

const AUTH_REQUIRED_PREFIX: &str = "GIT_AUTH_REQUIRED";
const AUTH_SEP: &str = "|||";

fn is_auth_error(e: &git2::Error) -> bool {
    e.code() == git2::ErrorCode::Auth
        || e.message().to_ascii_lowercase().contains("auth")
        || e.message().contains("authentication required")
        || e.message().contains("未找到远程凭据")
}

fn format_remote_error(op: &str, e: git2::Error, remote_url: &str) -> String {
    let msg = e.message().to_string();
    if is_auth_error(&e) {
        // 前端据此弹出账号密码框
        return format!("{AUTH_REQUIRED_PREFIX}{AUTH_SEP}{remote_url}{AUTH_SEP}{msg}");
    }
    format!("{op}失败: {msg}")
}

fn default_ssh_key_paths() -> Vec<std::path::PathBuf> {
    let mut keys = Vec::new();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    let Some(home) = home else {
        return keys;
    };
    let ssh = std::path::PathBuf::from(home).join(".ssh");
    for name in ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"] {
        let p = ssh.join(name);
        if p.is_file() {
            keys.push(p);
        }
    }
    keys
}

/// 解析 https://host/path 或 http://host/path → (protocol, host)
fn parse_http_remote(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let (protocol, rest) = if let Some(r) = url.strip_prefix("https://") {
        ("https", r)
    } else if let Some(r) = url.strip_prefix("http://") {
        ("http", r)
    } else {
        return None;
    };
    let host = rest.split('/').next().unwrap_or("").split('@').next_back()?;
    if host.is_empty() {
        return None;
    }
    let host = host.split('@').next_back().unwrap_or(host);
    Some((protocol.to_string(), host.to_string()))
}

fn cred_host_key(url: &str) -> Option<String> {
    let (protocol, host) = parse_http_remote(url)?;
    Some(format!("{protocol}://{host}"))
}

fn miro_cred_store_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".mirocode").join("git-credentials.json"))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct StoredGitCred {
    username: String,
    password: String,
}

fn load_miro_cred(url: &str) -> Option<(String, String)> {
    let key = cred_host_key(url)?;
    let path = miro_cred_store_path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let map: std::collections::HashMap<String, StoredGitCred> =
        serde_json::from_str(&raw).ok()?;
    let c = map.get(&key)?;
    if c.username.is_empty() || c.password.is_empty() {
        return None;
    }
    Some((c.username.clone(), c.password.clone()))
}

fn save_miro_cred(url: &str, username: &str, password: &str) {
    let Some(key) = cred_host_key(url) else {
        return;
    };
    let Some(path) = miro_cred_store_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut map: std::collections::HashMap<String, StoredGitCred> =
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
    map.insert(
        key,
        StoredGitCred {
            username: username.to_string(),
            password: password.to_string(),
        },
    );
    if let Ok(raw) = serde_json::to_string_pretty(&map) {
        let _ = std::fs::write(&path, raw);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

/// 写入系统 git credential（尽力而为）+ Miro Code 本地凭据（可靠记住）
fn save_git_credential(url: &str, username: &str, password: &str) {
    // 1. 应用内凭据：下次拉推可直接命中（不依赖钥匙串）
    save_miro_cred(url, username, password);

    // 2. 系统 helper（osxkeychain 等），失败不影响应用内记住
    let Some((protocol, host)) = parse_http_remote(url) else {
        return;
    };
    let payload = format!(
        "protocol={protocol}\nhost={host}\nusername={username}\npassword={password}\n\n"
    );
    let mut child = match std::process::Command::new("git")
        .args(["credential", "approve"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(payload.as_bytes());
    }
    let _ = child.wait();
}

/// 供登录弹窗预填：按远程 URL 查 Miro Code 已存用户名
#[tauri::command]
pub fn git_stored_username(url: String) -> Option<String> {
    load_miro_cred(&url).map(|(u, _)| u)
}

/// 远程凭据：显式账号密码 → Miro 已存凭据 → SSH → git credential helper
fn make_callbacks(
    username: Option<String>,
    password: Option<String>,
) -> RemoteCallbacks<'static> {
    let mut cb = RemoteCallbacks::new();
    cb.credentials(move |url, username_from_url, allowed| {
        let explicit_user = username.as_deref();
        let explicit_pass = password.as_deref();
        let stored = load_miro_cred(url);

        if allowed.contains(git2::CredentialType::USERNAME) {
            let user = explicit_user
                .or(stored.as_ref().map(|(u, _)| u.as_str()))
                .or(username_from_url)
                .unwrap_or("git");
            return Cred::username(user);
        }

        // 用户在弹窗中填写的 HTTPS 账号密码优先
        if let (Some(u), Some(p)) = (explicit_user, explicit_pass) {
            if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
                || allowed.contains(git2::CredentialType::DEFAULT)
            {
                return Cred::userpass_plaintext(u, p);
            }
        }

        // 应用内已记住的凭据
        if let Some((u, p)) = stored {
            if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
                || allowed.contains(git2::CredentialType::DEFAULT)
            {
                return Cred::userpass_plaintext(&u, &p);
            }
        }

        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            if let Ok(cred) = Cred::ssh_key_from_agent(user) {
                return Ok(cred);
            }
            for key in default_ssh_key_paths() {
                if let Ok(cred) = Cred::ssh_key(user, None, &key, None) {
                    return Ok(cred);
                }
            }
        }

        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
            || allowed.contains(git2::CredentialType::DEFAULT)
        {
            if let Ok(cfg) = git2::Config::open_default() {
                if let Ok(cred) = Cred::credential_helper(&cfg, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }

        Err(git2::Error::from_str(
            "未找到远程凭据（SSH 密钥或 HTTPS credential helper）",
        ))
    });
    cb
}

fn remote_url(remote: &git2::Remote<'_>) -> String {
    remote.url().unwrap_or("").to_string()
}

#[tauri::command]
pub fn git_pull(
    root: String,
    username: Option<String>,
    password: Option<String>,
    remember: Option<bool>,
) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().map_err(|e| e.to_string())?.to_string();
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("缺少 origin 远程: {e}"))?;
    let url = remote_url(&remote);
    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(make_callbacks(username.clone(), password.clone()));
    remote
        .fetch(&[branch.as_str()], Some(&mut opts), None)
        .map_err(|e| format_remote_error("拉取", e, &url))?;

    if remember.unwrap_or(false) {
        if let (Some(u), Some(p)) = (username.as_deref(), password.as_deref()) {
            save_git_credential(&url, u, p);
        }
    }

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
    git_commit(root, msg, None, None)?;
    Ok("合并拉取完成".into())
}

#[tauri::command]
pub fn git_push(
    root: String,
    force: Option<bool>,
    username: Option<String>,
    password: Option<String>,
    remember: Option<bool>,
) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().map_err(|e| e.to_string())?.to_string();
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("缺少 origin 远程: {e}"))?;
    let url = remote_url(&remote);
    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(make_callbacks(username.clone(), password.clone()));
    let refspec = if force.unwrap_or(false) {
        format!("+refs/heads/{branch}:refs/heads/{branch}")
    } else {
        format!("refs/heads/{branch}:refs/heads/{branch}")
    };
    remote
        .push(&[refspec.as_str()], Some(&mut push_opts))
        .map_err(|e| format_remote_error("推送", e, &url))?;

    if remember.unwrap_or(false) {
        if let (Some(u), Some(p)) = (username.as_deref(), password.as_deref()) {
            save_git_credential(&url, u, p);
        }
    }
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub index: usize,
    pub id: String,
    pub message: String,
}

#[tauri::command]
pub fn git_stash_list(root: String) -> Result<Vec<GitStashEntry>, String> {
    let mut repo = open_repo(&root)?;
    let mut out = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        out.push(GitStashEntry {
            index,
            id: oid.to_string(),
            message: message.to_string(),
        });
        true
    })
    .map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn git_stash_pop(root: String, index: Option<usize>) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    repo.stash_pop(index.unwrap_or(0), None)
        .map_err(|e| format!("弹出贮藏失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn git_stash_apply(root: String, index: usize) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    repo.stash_apply(index, None)
        .map_err(|e| format!("应用贮藏失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn git_stash_drop(root: String, index: usize) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    repo.stash_drop(index)
        .map_err(|e| format!("删除贮藏失败: {e}"))?;
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
    let oid = resolve_commit_oid(&repo, &commit_id)?;
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
    git_commit(root, format!("Merge branch '{name}'"), None, None)?;
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

// ==================== 完全体：Fetch / Update / Rebase / Cherry-pick / Reset / Blame ====================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    pub line: usize,
    pub commit_id: String,
    pub author: String,
    pub time: String,
    pub summary: String,
}

#[tauri::command]
pub fn git_remotes(root: String) -> Result<Vec<GitRemoteInfo>, String> {
    let repo = open_repo(&root)?;
    let names = repo.remotes().map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for i in 0..names.len() {
        let Ok(Some(name)) = names.get(i) else {
            continue;
        };
        let remote = repo.find_remote(name).ok();
        list.push(GitRemoteInfo {
            name: name.to_string(),
            url: remote
                .as_ref()
                .and_then(|r| r.url().ok().map(str::to_string)),
        });
    }
    Ok(list)
}

#[tauri::command]
pub fn git_unpushed_commits(
    root: String,
    limit: Option<usize>,
) -> Result<Vec<GitCommitInfo>, String> {
    let repo = open_repo(&root)?;
    let max = limit.unwrap_or(50).min(200);
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(vec![]),
    };
    if !head.is_branch() {
        return Ok(vec![]);
    }
    let branch_name = head.shorthand().map_err(|e| e.to_string())?.to_string();
    let branch = repo
        .find_branch(&branch_name, BranchType::Local)
        .map_err(|e| e.to_string())?;
    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(_) => return git_log(root, Some(max.min(20))),
    };
    let local_oid = head.peel_to_commit().map_err(|e| e.to_string())?.id();
    let remote_oid = upstream
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .id();

    let mut walk = repo.revwalk().map_err(|e| e.to_string())?;
    walk.push(local_oid).map_err(|e| e.to_string())?;
    let _ = walk.hide(remote_oid);

    let mut commits = Vec::new();
    for oid in walk.take(max) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let id_str = oid.to_string();
        let time = Local
            .timestamp_opt(commit.time().seconds(), 0)
            .single()
            .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();
        let parents: Vec<String> = (0..commit.parent_count())
            .filter_map(|i| commit.parent_id(i).ok())
            .map(|id| id.to_string())
            .collect();
        commits.push(GitCommitInfo {
            id: id_str,
            summary: commit
                .summary()
                .ok()
                .flatten()
                .unwrap_or("")
                .to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            time,
            files: vec![],
            parents,
            refs: vec![],
            unpushed: true,
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_fetch(
    root: String,
    remote: Option<String>,
    username: Option<String>,
    password: Option<String>,
    remember: Option<bool>,
) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let remote_name = remote.unwrap_or_else(|| "origin".into());
    let mut remote = repo
        .find_remote(&remote_name)
        .map_err(|e| format!("缺少远程 {remote_name}: {e}"))?;
    let url = remote_url(&remote);
    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(make_callbacks(username.clone(), password.clone()));
    remote
        .fetch(&[] as &[&str], Some(&mut opts), None)
        .map_err(|e| format_remote_error("Fetch", e, &url))?;
    if remember.unwrap_or(false) {
        if let (Some(u), Some(p)) = (username.as_deref(), password.as_deref()) {
            save_git_credential(&url, u, p);
        }
    }
    Ok(format!("已从 {remote_name} 获取更新"))
}

#[tauri::command]
pub fn git_update_project(
    root: String,
    strategy: String,
    username: Option<String>,
    password: Option<String>,
    remember: Option<bool>,
) -> Result<String, String> {
    git_fetch(
        root.clone(),
        Some("origin".into()),
        username.clone(),
        password.clone(),
        remember,
    )?;

    let repo = open_repo(&root)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().map_err(|e| e.to_string())?.to_string();
    let local_branch = repo
        .find_branch(&branch, BranchType::Local)
        .map_err(|e| e.to_string())?;
    let upstream = local_branch
        .upstream()
        .map_err(|_| "当前分支没有上游，请先设置 upstream 或 Push".to_string())?;
    let upstream_name = upstream
        .name()
        .map_err(|e| e.to_string())?
        .unwrap_or("")
        .to_string();

    match strategy.as_str() {
        "rebase" => git_rebase_onto(root, upstream_name),
        _ => {
            let commit = upstream.get().peel_to_commit().map_err(|e| e.to_string())?;
            let annotated = repo
                .find_annotated_commit(commit.id())
                .map_err(|e| e.to_string())?;
            let (analysis, _) = repo
                .merge_analysis(&[&annotated])
                .map_err(|e| e.to_string())?;
            if analysis.is_up_to_date() {
                return Ok("已是最新".into());
            }
            if analysis.is_fast_forward() {
                let refname = format!("refs/heads/{branch}");
                let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
                reference
                    .set_target(annotated.id(), "update fast-forward")
                    .map_err(|e| e.to_string())?;
                repo.set_head(&refname).map_err(|e| e.to_string())?;
                repo.checkout_head(Some(CheckoutBuilder::default().force()))
                    .map_err(|e| e.to_string())?;
                return Ok("快进更新完成".into());
            }
            repo.merge(&[&annotated], None, None)
                .map_err(|e| format!("合并失败: {e}"))?;
            if repo.index().map(|i| i.has_conflicts()).unwrap_or(false) {
                return Err("更新后存在冲突，请在 Commit 面板解决".into());
            }
            git_commit(
                root,
                format!("Merge remote-tracking branch '{upstream_name}'"),
                None,
                None,
            )?;
            Ok("合并更新完成".into())
        }
    }
}

fn resolve_branch_commit<'a>(
    repo: &'a Repository,
    name: &str,
) -> Result<git2::Commit<'a>, String> {
    repo.find_branch(name, BranchType::Local)
        .or_else(|_| {
            let n = if name.contains('/') {
                name.to_string()
            } else {
                format!("origin/{name}")
            };
            repo.find_branch(&n, BranchType::Remote)
        })
        .map_err(|e| format!("未找到分支 {name}: {e}"))?
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())
}

fn git_rebase_onto(root: String, onto_name: String) -> Result<String, String> {
    // 使用系统 git，冲突时保留 rebase 状态供 Continue/Abort
    let output = std::process::Command::new("git")
        .args(["rebase", &onto_name])
        .current_dir(&root)
        .output()
        .map_err(|e| format!("无法执行 git rebase: {e}"))?;
    if output.status.success() {
        return Ok(format!("已 rebase 到 {onto_name}"));
    }
    let err = String::from_utf8_lossy(&output.stderr);
    let out = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{err}\n{out}");
    if is_rebase_in_progress(&root) {
        return Err(format!(
            "GIT_REBASE_CONFLICT|||Rebase 产生冲突，请在 Commit 面板解决后 Continue\n{combined}"
        ));
    }
    Err(format!("Rebase 失败: {}", combined.trim()))
}

#[tauri::command]
pub fn git_rebase_branch(root: String, onto: String) -> Result<String, String> {
    git_rebase_onto(root, onto)
}

#[tauri::command]
pub fn git_cherry_pick(root: String, commit_id: String) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let oid = resolve_commit_oid(&repo, &commit_id)?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    repo.cherrypick(&commit, None)
        .map_err(|e| format!("Cherry-pick 失败: {e}"))?;
    if repo.index().map(|i| i.has_conflicts()).unwrap_or(false) {
        return Err("Cherry-pick 产生冲突，请在 Commit 面板解决".into());
    }
    let msg = commit.message().unwrap_or("Cherry-pick").to_string();
    git_commit(root, msg, None, None)?;
    Ok("Cherry-pick 完成".into())
}

#[tauri::command]
pub fn git_reset(root: String, commit_id: String, mode: String) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let oid = resolve_commit_oid(&repo, &commit_id)?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let reset_type = match mode.as_str() {
        "soft" => ResetType::Soft,
        "hard" => ResetType::Hard,
        _ => ResetType::Mixed,
    };
    repo.reset(commit.as_object(), reset_type, None)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "已 {} 重置到 {}",
        mode,
        &commit_id[..7.min(commit_id.len())]
    ))
}

#[tauri::command]
pub fn git_blame(root: String, path: String) -> Result<Vec<GitBlameLine>, String> {
    let repo = open_repo(&root)?;
    let blame = repo
        .blame_file(Path::new(&path), None)
        .map_err(|e| format!("Blame 失败: {e}"))?;
    let mut lines = Vec::new();
    for i in 0..blame.len() {
        let hunk = blame.get_index(i).ok_or_else(|| "blame hunk".to_string())?;
        let oid = hunk.final_commit_id();
        let id_str = oid.to_string();
        let short = id_str[..7.min(id_str.len())].to_string();
        let commit = repo.find_commit(oid).ok();
        let time = commit
            .as_ref()
            .and_then(|c| {
                Local
                    .timestamp_opt(c.time().seconds(), 0)
                    .single()
                    .map(|t| t.format("%Y-%m-%d").to_string())
            })
            .unwrap_or_default();
        let author_name = commit
            .as_ref()
            .map(|c| {
                let sig = c.author();
                match sig.name() {
                    Ok(n) => n.to_string(),
                    Err(_) => String::new(),
                }
            })
            .unwrap_or_default();
        let summary_text = commit
            .as_ref()
            .map(|c| {
                c.summary()
                    .ok()
                    .flatten()
                    .unwrap_or("")
                    .to_string()
            })
            .unwrap_or_default();
        let start = hunk.final_start_line();
        let lines_in_hunk = hunk.lines_in_hunk();
        for offset in 0..lines_in_hunk {
            lines.push(GitBlameLine {
                line: start + offset,
                commit_id: short.clone(),
                author: author_name.clone(),
                time: time.clone(),
                summary: summary_text.clone(),
            });
        }
    }
    Ok(lines)
}

#[tauri::command]
pub fn git_set_upstream(root: String, branch: String, upstream: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let mut b = repo
        .find_branch(&branch, BranchType::Local)
        .map_err(|e| e.to_string())?;
    b.set_upstream(Some(&upstream)).map_err(|e| e.to_string())
}

/// 从远程分支检出为本地分支（并设置 upstream）
#[tauri::command]
pub fn git_checkout_remote(
    root: String,
    remote_ref: String,
    local_name: Option<String>,
) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let commit = resolve_branch_commit(&repo, &remote_ref)?;
    let local = local_name.unwrap_or_else(|| {
        remote_ref
            .rsplit('/')
            .next()
            .unwrap_or(&remote_ref)
            .to_string()
    });
    if repo.find_branch(&local, BranchType::Local).is_ok() {
        git_checkout(root, local.clone(), Some(false))?;
        return Ok(format!("已切换到已有分支 {local}"));
    }
    repo.branch(&local, &commit, false)
        .map_err(|e| e.to_string())?;
    if let Ok(mut b) = repo.find_branch(&local, BranchType::Local) {
        let _ = b.set_upstream(Some(&remote_ref));
    }
    git_checkout(root, local.clone(), Some(false))?;
    Ok(format!("已从 {remote_ref} 创建并切换到 {local}"))
}

// ==================== Rebase 状态 / 交互 / 扩展 ====================

fn git_dir(root: &str) -> Result<PathBuf, String> {
    let repo = open_repo(root)?;
    Ok(repo.path().to_path_buf())
}

fn is_rebase_in_progress(root: &str) -> bool {
    let Ok(dir) = git_dir(root) else {
        return false;
    };
    dir.join("rebase-merge").is_dir() || dir.join("rebase-apply").is_dir()
}

fn is_miro_rebase_in_progress(root: &str) -> bool {
    git_dir(root)
        .map(|d| d.join("miro-rebase.json").is_file())
        .unwrap_or(false)
}

fn run_git(root: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("无法执行 git {}: {e}", args.join(" ")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() {
            stderr
        } else {
            stdout
        })
    } else {
        let msg = if stderr.is_empty() { stdout } else { stderr };
        Err(msg)
    }
}

fn resolve_commit_oid(repo: &Repository, id: &str) -> Result<git2::Oid, String> {
    let obj = repo
        .revparse_single(id)
        .map_err(|e| format!("无效提交 {id}: {e}"))?;
    let commit = obj
        .peel_to_commit()
        .map_err(|e| format!("不是提交 {id}: {e}"))?;
    Ok(commit.id())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRebaseStatus {
    pub in_progress: bool,
    pub kind: String,
    pub head_name: Option<String>,
    pub onto: Option<String>,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRebaseStep {
    pub action: String,
    pub commit_id: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiroRebaseState {
    onto: String,
    branch: String,
    /// rebase 开始前的 HEAD，供 Abort 恢复
    original_head: String,
    remaining: Vec<GitRebaseStep>,
    squash_msgs: Vec<String>,
}

fn miro_rebase_path(root: &str) -> Result<PathBuf, String> {
    Ok(git_dir(root)?.join("miro-rebase.json"))
}

fn load_miro_rebase(root: &str) -> Result<MiroRebaseState, String> {
    let path = miro_rebase_path(root)?;
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取 rebase 状态失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析 rebase 状态失败: {e}"))
}

fn save_miro_rebase(root: &str, state: &MiroRebaseState) -> Result<(), String> {
    let path = miro_rebase_path(root)?;
    let raw = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

fn clear_miro_rebase(root: &str) {
    if let Ok(path) = miro_rebase_path(root) {
        let _ = std::fs::remove_file(path);
    }
}

fn commit_info_from_oid(repo: &Repository, oid: git2::Oid) -> Result<GitCommitInfo, String> {
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let time = Local
        .timestamp_opt(commit.time().seconds(), 0)
        .single()
        .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default();
    let parents: Vec<String> = (0..commit.parent_count())
        .filter_map(|i| commit.parent_id(i).ok())
        .map(|id| id.to_string())
        .collect();
    let author = commit.author().name().unwrap_or("").to_string();
    let summary = commit
        .summary()
        .ok()
        .flatten()
        .unwrap_or("")
        .to_string();
    Ok(GitCommitInfo {
        id: oid.to_string(),
        summary,
        author,
        time,
        files: vec![],
        parents,
        refs: vec![],
        unpushed: false,
    })
}

#[tauri::command]
pub fn git_rebase_status(root: String) -> Result<GitRebaseStatus, String> {
    let repo = open_repo(&root)?;
    let conflicted = repo.index().map(|i| i.has_conflicts()).unwrap_or(false);
    let miro = is_miro_rebase_in_progress(&root);
    let native = is_rebase_in_progress(&root);
    let in_progress = miro || native;
    let kind = if miro {
        "miro".into()
    } else if native {
        "git".into()
    } else {
        "none".into()
    };
    let mut head_name = None;
    let mut onto = None;
    if let Ok(dir) = git_dir(&root) {
        let head_file = dir.join("rebase-merge").join("head-name");
        if let Ok(s) = std::fs::read_to_string(head_file) {
            head_name = Some(s.trim().trim_start_matches("refs/heads/").to_string());
        }
        let onto_file = dir.join("rebase-merge").join("onto");
        if let Ok(s) = std::fs::read_to_string(onto_file) {
            onto = Some(s.trim().chars().take(7).collect());
        }
        if miro {
            if let Ok(state) = load_miro_rebase(&root) {
                head_name = Some(state.branch);
                onto = Some(state.onto.chars().take(7).collect());
            }
        }
    }
    Ok(GitRebaseStatus {
        in_progress,
        kind,
        head_name,
        onto,
        conflicted,
    })
}

#[tauri::command]
pub fn git_rebase_continue(root: String) -> Result<String, String> {
    if is_miro_rebase_in_progress(&root) {
        // 先提交当前冲突解决结果（若仍有未暂存冲突则失败）
        let repo = open_repo(&root)?;
        if repo.index().map(|i| i.has_conflicts()).unwrap_or(false) {
            return Err("仍有未解决冲突，请先在 Commit 面板解决".into());
        }
        // 若处于 cherry-pick 中间态
        if repo.path().join("CHERRY_PICK_HEAD").is_file() {
            let _ = run_git(&root, &["-c", "core.editor=true", "cherry-pick", "--continue"]);
        } else if !repo
            .statuses(None)
            .map(|s| s.is_empty())
            .unwrap_or(true)
        {
            // 有已暂存变更则提交
            let msg = "Miro Code rebase continue";
            let _ = git_commit(root.clone(), msg.into(), None, None);
        }
        return replay_miro_rebase(root);
    }
    match run_git(
        &root,
        &["-c", "core.editor=true", "rebase", "--continue"],
    ) {
        Ok(msg) => Ok(if msg.is_empty() {
            "Rebase 已继续".into()
        } else {
            msg
        }),
        Err(e) => {
            if is_rebase_in_progress(&root) {
                Err(format!(
                    "GIT_REBASE_CONFLICT|||继续 Rebase 仍有冲突\n{e}"
                ))
            } else {
                Err(e)
            }
        }
    }
}

#[tauri::command]
pub fn git_rebase_abort(root: String) -> Result<String, String> {
    if is_miro_rebase_in_progress(&root) {
        let state = load_miro_rebase(&root)?;
        let _ = run_git(&root, &["cherry-pick", "--abort"]);
        let _ = run_git(&root, &["checkout", &state.branch]);
        let _ = run_git(&root, &["reset", "--hard", &state.original_head]);
        clear_miro_rebase(&root);
        return Ok("已中止交互 Rebase".into());
    }
    run_git(&root, &["rebase", "--abort"])?;
    Ok("已中止 Rebase".into())
}

#[tauri::command]
pub fn git_rebase_skip(root: String) -> Result<String, String> {
    if is_miro_rebase_in_progress(&root) {
        let _ = run_git(&root, &["cherry-pick", "--abort"]);
        let mut state = load_miro_rebase(&root)?;
        if !state.remaining.is_empty() {
            state.remaining.remove(0);
            save_miro_rebase(&root, &state)?;
        }
        return replay_miro_rebase(root);
    }
    match run_git(&root, &["rebase", "--skip"]) {
        Ok(msg) => Ok(if msg.is_empty() {
            "已跳过当前提交".into()
        } else {
            msg
        }),
        Err(e) => {
            if is_rebase_in_progress(&root) {
                Err(format!("GIT_REBASE_CONFLICT|||Skip 后仍有冲突\n{e}"))
            } else {
                Err(e)
            }
        }
    }
}

/// onto..HEAD 的提交列表（旧→新，供交互 Rebase）
#[tauri::command]
pub fn git_rebase_plan(root: String, onto: String) -> Result<Vec<GitCommitInfo>, String> {
    let repo = open_repo(&root)?;
    let onto_oid = resolve_commit_oid(&repo, &onto)?;
    let head_oid = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .id();
    let mut walk = repo.revwalk().map_err(|e| e.to_string())?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::REVERSE)
        .map_err(|e| e.to_string())?;
    walk.push(head_oid).map_err(|e| e.to_string())?;
    walk.hide(onto_oid).map_err(|e| e.to_string())?;
    let mut commits = Vec::new();
    for oid in walk {
        let oid = oid.map_err(|e| e.to_string())?;
        commits.push(commit_info_from_oid(&repo, oid)?);
    }
    Ok(commits)
}

fn replay_miro_rebase(root: String) -> Result<String, String> {
    let mut state = load_miro_rebase(&root)?;
    let repo = open_repo(&root)?;

    while let Some(step) = state.remaining.first().cloned() {
        let action = step.action.to_lowercase();
        if action == "drop" {
            state.remaining.remove(0);
            save_miro_rebase(&root, &state)?;
            continue;
        }

        let oid = resolve_commit_oid(&repo, &step.commit_id)?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let default_msg = commit.message().unwrap_or("").to_string();

        match action.as_str() {
            "pick" | "reword" => {
                let out = std::process::Command::new("git")
                    .args(["cherry-pick", &step.commit_id])
                    .current_dir(&root)
                    .output()
                    .map_err(|e| e.to_string())?;
                if !out.status.success() {
                    save_miro_rebase(&root, &state)?;
                    if open_repo(&root)
                        .ok()
                        .and_then(|r| r.index().ok())
                        .map(|i| i.has_conflicts())
                        .unwrap_or(false)
                    {
                        return Err(
                            "GIT_REBASE_CONFLICT|||交互 Rebase 冲突，请解决后 Continue".into(),
                        );
                    }
                    return Err(format!(
                        "Cherry-pick 失败: {}",
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
                if action == "reword" {
                    let msg = step.message.unwrap_or(default_msg);
                    git_commit(root.clone(), msg, None, Some(true))?;
                }
                state.squash_msgs.clear();
            }
            "fix" => {
                let out = std::process::Command::new("git")
                    .args(["cherry-pick", "-n", &step.commit_id])
                    .current_dir(&root)
                    .output()
                    .map_err(|e| e.to_string())?;
                if !out.status.success() {
                    save_miro_rebase(&root, &state)?;
                    if open_repo(&root)
                        .ok()
                        .and_then(|r| r.index().ok())
                        .map(|i| i.has_conflicts())
                        .unwrap_or(false)
                    {
                        return Err(
                            "GIT_REBASE_CONFLICT|||交互 Rebase 冲突，请解决后 Continue".into(),
                        );
                    }
                    return Err(format!(
                        "Fixup 失败: {}",
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
                // amend 保留原信息
                let _ = run_git(
                    &root,
                    &["commit", "--amend", "--no-edit", "--allow-empty"],
                );
            }
            "squash" => {
                let out = std::process::Command::new("git")
                    .args(["cherry-pick", "-n", &step.commit_id])
                    .current_dir(&root)
                    .output()
                    .map_err(|e| e.to_string())?;
                if !out.status.success() {
                    save_miro_rebase(&root, &state)?;
                    if open_repo(&root)
                        .ok()
                        .and_then(|r| r.index().ok())
                        .map(|i| i.has_conflicts())
                        .unwrap_or(false)
                    {
                        return Err(
                            "GIT_REBASE_CONFLICT|||交互 Rebase 冲突，请解决后 Continue".into(),
                        );
                    }
                    return Err(format!(
                        "Squash 失败: {}",
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }
                let msg = step.message.unwrap_or(default_msg);
                state.squash_msgs.push(msg.clone());
                let head_msg = {
                    let repo2 = open_repo(&root)?;
                    repo2
                        .head()
                        .ok()
                        .and_then(|h| h.peel_to_commit().ok())
                        .and_then(|c| c.message().ok().map(|m| m.to_string()))
                        .unwrap_or_default()
                };
                let combined = format!("{}\n\n{}", head_msg.trim(), msg.trim());
                git_commit(root.clone(), combined, None, Some(true))?;
            }
            _ => {
                return Err(format!("未知 rebase 动作: {action}"));
            }
        }

        state.remaining.remove(0);
        save_miro_rebase(&root, &state)?;
    }

    clear_miro_rebase(&root);
    Ok("交互 Rebase 完成".into())
}

#[tauri::command]
pub fn git_rebase_interactive(
    root: String,
    onto: String,
    steps: Vec<GitRebaseStep>,
) -> Result<String, String> {
    if steps.is_empty() {
        return Err("没有可重放的提交".into());
    }
    if is_rebase_in_progress(&root) || is_miro_rebase_in_progress(&root) {
        return Err("已有 Rebase 进行中，请先 Continue 或 Abort".into());
    }
    let repo = open_repo(&root)?;
    let branch = repo
        .head()
        .ok()
        .and_then(|h| {
            if h.is_branch() {
                h.shorthand().ok().map(|s| s.to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| "请在本地分支上执行交互 Rebase".to_string())?;

    let onto_oid = resolve_commit_oid(&repo, &onto)?;
    let original_head = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .id()
        .to_string();
    // 硬重置到 onto，再按步骤重放
    let onto_commit = repo.find_commit(onto_oid).map_err(|e| e.to_string())?;
    repo.reset(onto_commit.as_object(), ResetType::Hard, None)
        .map_err(|e| format!("重置到 onto 失败: {e}"))?;

    let state = MiroRebaseState {
        onto: onto_oid.to_string(),
        branch,
        original_head,
        remaining: steps,
        squash_msgs: vec![],
    };
    save_miro_rebase(&root, &state)?;
    replay_miro_rebase(root)
}

/// 真正的 git revert（生成反向提交）
#[tauri::command]
pub fn git_revert_commit(root: String, commit_id: String) -> Result<String, String> {
    match run_git(
        &root,
        &["-c", "core.editor=true", "revert", "--no-edit", &commit_id],
    ) {
        Ok(_) => Ok(format!("已 revert {}", &commit_id[..7.min(commit_id.len())])),
        Err(e) => {
            let repo = open_repo(&root)?;
            if repo.index().map(|i| i.has_conflicts()).unwrap_or(false) {
                Err(format!(
                    "Revert 产生冲突，请在 Commit 面板解决\n{e}"
                ))
            } else {
                Err(format!("Revert 失败: {e}"))
            }
        }
    }
}

#[tauri::command]
pub fn git_create_branch_at(
    root: String,
    name: String,
    commit_id: String,
    checkout: bool,
) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let oid = resolve_commit_oid(&repo, &commit_id)?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    repo.branch(&name, &commit, false)
        .map_err(|e| e.to_string())?;
    if checkout {
        git_checkout(root, name, Some(false))?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_checkout_commit(root: String, commit_id: String) -> Result<String, String> {
    let repo = open_repo(&root)?;
    let oid = resolve_commit_oid(&repo, &commit_id)?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    repo.set_head_detached(commit.id())
        .map_err(|e| e.to_string())?;
    repo.checkout_head(Some(CheckoutBuilder::default().force()))
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "已检出分离头指针 {}",
        &commit_id[..7.min(commit_id.len())]
    ))
}

#[tauri::command]
pub fn git_delete_remote_branch(root: String, remote_ref: String) -> Result<String, String> {
    // remote_ref 形如 origin/feature
    let (remote, branch) = remote_ref
        .split_once('/')
        .ok_or_else(|| "远程分支名无效，期望 remote/branch".to_string())?;
    run_git(&root, &["push", remote, "--delete", branch])?;
    let _ = run_git(&root, &["fetch", "--prune", remote]);
    Ok(format!("已删除远程分支 {remote_ref}"))
}

/// 对比两分支 tip 的文件树差异摘要（打开第一个差异文件的分栏用）
#[tauri::command]
pub fn git_branch_sides(
    root: String,
    left_ref: String,
    right_ref: String,
    path: Option<String>,
) -> Result<GitFileSides, String> {
    let repo = open_repo(&root)?;
    let left_oid = resolve_commit_oid(&repo, &left_ref)?;
    let right_oid = resolve_commit_oid(&repo, &right_ref)?;
    let left_commit = repo.find_commit(left_oid).map_err(|e| e.to_string())?;
    let right_commit = repo.find_commit(right_oid).map_err(|e| e.to_string())?;
    let left_tree = left_commit.tree().map_err(|e| e.to_string())?;
    let right_tree = right_commit.tree().map_err(|e| e.to_string())?;

    let rel = if let Some(p) = path.filter(|s| !s.is_empty()) {
        p
    } else {
        let mut first = None;
        if let Ok(diff) = repo.diff_tree_to_tree(Some(&left_tree), Some(&right_tree), None) {
            let _ = diff.foreach(
                &mut |delta, _| {
                    if first.is_none() {
                        if let Some(path) =
                            delta.new_file().path().or_else(|| delta.old_file().path())
                        {
                            first = Some(path.to_string_lossy().to_string());
                        }
                    }
                    true
                },
                None,
                None,
                None,
            );
        }
        first.ok_or_else(|| "两个分支 tip 无文件差异".to_string())?
    };

    let blob_text = |tree: &git2::Tree, path: &str| -> String {
        let Ok(entry) = tree.get_path(Path::new(path)) else {
            return String::new();
        };
        let Ok(obj) = entry.to_object(&repo) else {
            return String::new();
        };
        let Ok(blob) = obj.peel_to_blob() else {
            return String::new();
        };
        String::from_utf8_lossy(blob.content()).to_string()
    };

    Ok(GitFileSides {
        path: rel.clone(),
        left: blob_text(&left_tree, &rel),
        right: blob_text(&right_tree, &rel),
        left_label: left_ref,
        right_label: right_ref,
    })
}

