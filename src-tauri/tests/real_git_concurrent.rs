//! 真实 git_status 在 Tauri 2 调度层并发的证据测试
//!
//! 用 `git2` crate 真实打开仓库 + 跑 status walk，
//! 验证与"push 卡 800ms"并发时不被阻塞。

use std::time::{Duration, Instant};

/// 真实 git_status walk（用 git2 crate 模拟真 git_status 内部）
fn call_real_git_status(root: String) {
    if let Ok(repo) = git2::Repository::discover(&root) {
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true);
        let _ = repo.statuses(Some(&mut opts));
    }
}

/// 模拟"push 卡 800ms"——和真 git_push 一样的 spawn_blocking 模式
async fn fake_slow_push() -> Result<&'static str, String> {
    tokio::task::spawn_blocking(|| {
        std::thread::sleep(Duration::from_millis(800));
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok("pushed")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_git_status_concurrent_with_fake_push() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().to_str().unwrap().to_string();

    // 初始化真 git 仓库
    {
        let repo = git2::Repository::init(&root).expect("git init");
        let mut cfg = repo.config().expect("config");
        cfg.set_str("user.email", "test@example.com").ok();
        cfg.set_str("user.name", "test").ok();
        let sig = git2::Signature::now("test", "test@example.com").unwrap();
        let tree_oid = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).ok();
    }

    // push 卡 800ms
    let push_task = tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let r = fake_slow_push().await;
        (started.elapsed(), r)
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    // 期间连发 3 个真 git_status walk（走 spawn_blocking 走真 git2）
    let start = Instant::now();
    let mut handles = Vec::new();
    for _ in 0..3 {
        let root_clone = root.clone();
        let h = tauri::async_runtime::spawn_blocking(move || {
            let s = Instant::now();
            call_real_git_status(root_clone);
            s.elapsed()
        });
        handles.push(h);
    }
    let mut max_elapsed = Duration::ZERO;
    for h in handles {
        let e = h.await.expect("join");
        if e > max_elapsed {
            max_elapsed = e;
        }
    }
    let total = start.elapsed();

    assert!(
        total < Duration::from_millis(500),
        "3 个真 git_status 应不被 push 阻塞；总耗时 {total:?}，单次最长 {max_elapsed:?}"
    );
    assert!(
        max_elapsed < Duration::from_millis(300),
        "单次 git_status 应 <300ms；实际 {max_elapsed:?}"
    );

    let (push_elapsed, push_result) = push_task.await.expect("join");
    assert_eq!(push_result, Ok("pushed"));
    assert!(push_elapsed >= Duration::from_millis(800));
}
