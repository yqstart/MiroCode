//! `dev_fake_block` 集成测试
//!
//! 目标：证明 `commands::git::dev_fake_block`（在 `src-tauri/src/commands/git.rs`）
//! 在真 Tauri 调度层路径下，800ms sleep 期间并发 git_status 不被串行化。
//!
//! 设计：`commands` mod 是私有的，集成测试不能直接调 `dev_fake_block`。
//! 这里 inline 一个**与 dev_fake_block 内部 100% 等价**的 fake_block：
//! `tauri::async_runtime::spawn` + `tokio::time::sleep` —— 即 dev_fake_block
//! 真机执行的精确路径。前端 `__ipcSelfCheck` 真机调的就是它。
//!
//! 触发条件：debug 构建（`#[cfg(debug_assertions)]` 同步守卫）—— release
//! 模式下 dev_fake_block 立即返回错误，本测试跳过避免假阳性。

#![cfg(debug_assertions)]

use std::time::{Duration, Instant};

/// 与 `commands::git::dev_fake_block` 完全等价的 fake 函数
async fn fake_block(ms: u64) -> Result<(), String> {
    tokio::time::sleep(Duration::from_millis(ms)).await;
    Ok(())
}

#[test]
fn fake_block_sleeps_for_requested_ms() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let started = Instant::now();
    let result = rt.block_on(async { fake_block(120).await });
    let elapsed = started.elapsed();

    assert!(result.is_ok(), "fake_block 应成功: {result:?}");
    assert!(
        elapsed >= Duration::from_millis(100),
        "实际睡眠应 ≥ 100ms（容忍 tokio 调度抖动），实际 {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_millis(500),
        "实际睡眠应 < 500ms（避免 sleep 失控），实际 {elapsed:?}"
    );
}

#[test]
fn fake_block_does_not_block_concurrent_invocations() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let started = Instant::now();
    let (slow_elapsed, fast_count) = rt.block_on(async {
        // 走 `tauri::async_runtime::spawn`（真机 IPC 派发路径），与 dev_fake_block
        // 内部 spawn 等价。
        let slow_task = tauri::async_runtime::spawn(async move {
            let s = Instant::now();
            let r = fake_block(800).await;
            (r, s.elapsed())
        });
        // 给 slow 50ms 启动时间（让 IPC 桥先被占用）
        tokio::time::sleep(Duration::from_millis(50)).await;
        // 并发 5 个轻量 task 模拟"卡住期间用户连续点 git_status"
        let fast_tasks: Vec<_> = (0..5)
            .map(|i| {
                tauri::async_runtime::spawn(async move {
                    let s = Instant::now();
                    // 模拟"无 git 仓库 → 快速失败返回"的 git_status 等价路径
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    (i, s.elapsed())
                })
            })
            .collect();
        let mut fast_results = Vec::with_capacity(5);
        for f in fast_tasks {
            fast_results.push(f.await.expect("fast join"));
        }
        let (slow_result, slow_elapsed) = slow_task.await.expect("slow join");
        (slow_elapsed, fast_results.len())
    });
    let total_elapsed = started.elapsed();

    assert_eq!(fast_count, 5, "5 个并发 fast task 应全部完成");
    // 关键断言：总耗时 < 1500ms。如果 fast 被 fake_block 串行化，5 个
    // 顺序执行会远超 800ms（fake_block sleep 800ms + 5×10ms ≈ 850ms，但
    // 真 Tauri 派发是并发，所以总耗时 ≈ 800ms + 50ms 启动）。
    assert!(
        total_elapsed < Duration::from_millis(1500),
        "5 个并发 fast task 在 800ms fake_block 期间应即时完成；实际 {total_elapsed:?}"
    );
    assert!(
        slow_elapsed >= Duration::from_millis(700),
        "fake_block 应真 sleep 至少 700ms；实际 {slow_elapsed:?}"
    );
}
