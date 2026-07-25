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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub path: String,
    pub patch: String,
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
pub fn git_checkout(root: String, name: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let (object, reference) = repo.revparse_ext(&name).map_err(|e| e.to_string())?;
    repo.checkout_tree(&object, None).map_err(|e| e.to_string())?;
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
        git_checkout(root, name)?;
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
    revwalk
        .set_sorting(git2::Sort::TIME)
        .map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);
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
        commits.push(GitCommitInfo {
            id: id[..8.min(id.len())].to_string(),
            summary: commit
                .summary()
                .ok()
                .flatten()
                .unwrap_or("")
                .to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            time,
            files,
        });
    }
    Ok(commits)
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
pub fn git_stash(root: String, message: Option<String>) -> Result<(), String> {
    let mut repo = open_repo(&root)?;
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let msg = message.unwrap_or_else(|| "Miro Code stash".into());
    repo.stash_save(&sig, &msg, Some(StashFlags::DEFAULT))
        .map_err(|e| e.to_string())?;
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
