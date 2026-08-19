use std::{
    collections::BTreeMap,
    ffi::OsString,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtyPair, PtySize};
use tauri::{
    async_runtime::RwLock,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[derive(Default)]
struct PluginState {
    session_id: AtomicU32,
    sessions: RwLock<BTreeMap<PtyHandler, Arc<Session>>>,
}

struct Session {
    // 这些锁只在 blocking 线程中持有；不能用异步 Mutex 包住同步 read/wait。
    pair: Mutex<PtyPair>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    child_killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader: Mutex<Box<dyn std::io::Read + Send>>,
}

type PtyHandler = u32;

fn join_error(error: impl std::fmt::Display) -> String {
    format!("PTY 阻塞任务失败：{error}")
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn spawn<R: Runtime>(
    file: String,
    args: Vec<String>,
    term_name: Option<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    encoding: Option<String>,
    handle_flow_control: Option<bool>,
    flow_control_pause: Option<String>,
    flow_control_resume: Option<String>,

    state: tauri::State<'_, PluginState>,
    _app_handle: AppHandle<R>,
) -> Result<PtyHandler, String> {
    // 暂不支持这些参数
    let _ = term_name;
    let _ = encoding;
    let _ = handle_flow_control;
    let _ = flow_control_pause;
    let _ = flow_control_resume;

    let session = tauri::async_runtime::spawn_blocking(move || -> Result<Session, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(file);
        cmd.args(args);
        if let Some(cwd) = cwd {
            cmd.cwd(OsString::from(cwd));
        }
        for (key, value) in env {
            cmd.env(OsString::from(key), OsString::from(value));
        }
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let child_killer = child.clone_killer();

        Ok(Session {
            pair: Mutex::new(pair),
            child: Mutex::new(child),
            child_killer: Mutex::new(child_killer),
            writer: Mutex::new(writer),
            reader: Mutex::new(reader),
        })
    })
    .await
    .map_err(join_error)??;

    let handler = state.session_id.fetch_add(1, Ordering::Relaxed);
    state
        .sessions
        .write()
        .await
        .insert(handler, Arc::new(session));
    Ok(handler)
}

#[tauri::command]
async fn write(
    pid: PtyHandler,
    data: String,
    state: tauri::State<'_, PluginState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "PTY writer lock poisoned".to_string())?;
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn read(
    pid: PtyHandler,
    state: tauri::State<'_, PluginState>,
) -> Result<tauri::ipc::Response, String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut buf = vec![0u8; 4096];
        let n = session
            .reader
            .lock()
            .map_err(|_| "PTY reader lock poisoned".to_string())?
            .read(&mut buf)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            Err(String::from("EOF"))
        } else {
            buf.truncate(n);
            Ok(tauri::ipc::Response::new(buf))
        }
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn resize(
    pid: PtyHandler,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PluginState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        session
            .pair
            .lock()
            .map_err(|_| "PTY pair lock poisoned".to_string())?
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn kill(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        session
            .child_killer
            .lock()
            .map_err(|_| "PTY child killer lock poisoned".to_string())?
            .kill()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn exitstatus(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<u32, String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    let exitstatus = tauri::async_runtime::spawn_blocking(move || {
        session
            .child
            .lock()
            .map_err(|_| "PTY child lock poisoned".to_string())?
            .wait()
            .map(|status| status.exit_code())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(join_error)??;

    // 仅在子进程退出后从状态中移除会话。
    let _ = state.sessions.write().await.remove(&pid);

    Ok(exitstatus)
}

#[tauri::command]
async fn get_all_pids(state: tauri::State<'_, PluginState>) -> Result<Vec<PtyHandler>, String> {
    let sessions = state.sessions.read().await.clone();
    Ok(sessions.keys().copied().collect())
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("pty")
        .invoke_handler(tauri::generate_handler![
            spawn,
            write,
            read,
            resize,
            kill,
            exitstatus,
            get_all_pids
        ])
        .setup(|app_handle, _api| {
            app_handle.manage(PluginState::default());
            Ok(())
        })
        .build()
}
