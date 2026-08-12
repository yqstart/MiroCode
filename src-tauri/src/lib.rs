use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Runtime,
};

pub mod commands;

struct NativeMenuLabels {
    file: &'static str,
    edit: &'static str,
    open_folder: &'static str,
    save: &'static str,
    find_file: &'static str,
    search: &'static str,
    reveal: &'static str,
    terminal: &'static str,
    sidebar: &'static str,
    settings: &'static str,
    quit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    find_in_editor: &'static str,
}

fn menu_labels(locale: &str) -> NativeMenuLabels {
    if locale == "en-US" || locale.starts_with("en") {
        NativeMenuLabels {
            file: "File",
            edit: "Edit",
            open_folder: "Open Folder…",
            save: "Save",
            find_file: "Find File…",
            search: "Find in Files…",
            reveal: "Reveal in Explorer",
            terminal: "Toggle Terminal",
            sidebar: "Toggle Sidebar",
            settings: "Settings…",
            quit: "Quit Miro Code",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            find_in_editor: "Find…",
        }
    } else {
        NativeMenuLabels {
            file: "文件",
            edit: "编辑",
            open_folder: "打开文件夹…",
            save: "保存",
            find_file: "查找文件…",
            search: "在文件中查找…",
            reveal: "在资源管理器中显示",
            terminal: "切换终端",
            sidebar: "切换侧边栏",
            settings: "设置…",
            quit: "退出 Miro Code",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "复制",
            paste: "粘贴",
            select_all: "全选",
            find_in_editor: "查找…",
        }
    }
}

fn build_app_menu<R: Runtime>(
    handle: &AppHandle<R>,
    locale: &str,
) -> tauri::Result<Menu<R>> {
    let l = menu_labels(locale);

    let open_folder =
        MenuItem::with_id(handle, "open_folder", l.open_folder, true, Some("CmdOrCtrl+O"))?;
    let save = MenuItem::with_id(handle, "save", l.save, true, Some("CmdOrCtrl+S"))?;
    let find_file =
        MenuItem::with_id(handle, "find_file", l.find_file, true, Some("CmdOrCtrl+P"))?;
    let search =
        MenuItem::with_id(handle, "search", l.search, true, Some("CmdOrCtrl+Shift+F"))?;
    let reveal_in_explorer = MenuItem::with_id(
        handle,
        "reveal_in_explorer",
        l.reveal,
        true,
        Some("Alt+F1"),
    )?;
    let terminal =
        MenuItem::with_id(handle, "terminal", l.terminal, true, Some("CmdOrCtrl+J"))?;
    let toggle_sidebar = MenuItem::with_id(
        handle,
        "toggle_sidebar",
        l.sidebar,
        true,
        Some("CmdOrCtrl+B"),
    )?;
    let settings = MenuItem::with_id(handle, "settings", l.settings, true, Some("CmdOrCtrl+,"))?;
    let find_in_editor = MenuItem::with_id(
        handle,
        "find_in_editor",
        l.find_in_editor,
        true,
        Some("CmdOrCtrl+F"),
    )?;
    let separator = PredefinedMenuItem::separator(handle)?;
    let quit = PredefinedMenuItem::quit(handle, Some(l.quit))?;

    let file_menu = Submenu::with_items(
        handle,
        l.file,
        true,
        &[
            &open_folder,
            &save,
            &separator,
            &find_file,
            &search,
            &reveal_in_explorer,
            &terminal,
            &toggle_sidebar,
            &separator,
            &settings,
            &quit,
        ],
    )?;

    // macOS WKWebView：自定义菜单会替换系统默认「编辑」菜单，
    // 必须显式加入剪切/复制/粘贴，否则 Cmd+X/C/V 无法路由到 Web 内容。
    // 预定义项传入显式文案，跟随应用语言，而非 macOS 系统语言。
    let edit_menu = Submenu::with_items(
        handle,
        l.edit,
        true,
        &[
            &PredefinedMenuItem::undo(handle, Some(l.undo))?,
            &PredefinedMenuItem::redo(handle, Some(l.redo))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, Some(l.cut))?,
            &PredefinedMenuItem::copy(handle, Some(l.copy))?,
            &PredefinedMenuItem::paste(handle, Some(l.paste))?,
            &PredefinedMenuItem::select_all(handle, Some(l.select_all))?,
            &separator,
            &find_in_editor,
        ],
    )?;

    Menu::with_items(handle, &[&file_menu, &edit_menu])
}

/// 按应用内语言重建原生菜单栏（无需重启）
#[tauri::command]
fn set_app_menu_locale(app: AppHandle, locale: String) -> Result<(), String> {
    let menu = build_app_menu(&app, &locale).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== macOS：启动拉前 + Dock 菜单 ====================

// ==================== macOS 启动拉前 ====================
// 之前尝试在 setup 闭包里直接调 NSApp.setActivationPolicy()，
// 会跟 tao 0.35 的 did_finish_launching 内部 AppState::launched 第二次设
// activation policy 时序冲突，触发 MainThreadMarker::new().unwrap() 跨
// extern "C" 边界 panic，被 abort 转成 "panic in a function that cannot unwind"。
// 拉前动作改由前端 AppShell mount 时调 getCurrentWindow().setFocus() 实现。

// ==================== macOS Dock 菜单（右键 Dock 图标） ====================

/// 触发重建 Dock 菜单的状态。
#[derive(Debug, Clone, serde::Deserialize)]
struct DockStatePayload {
    recent: Vec<String>,
    #[serde(rename = "currentFile")]
    current_file: Option<String>,
}

/// 用 objc2 直接构建 NSMenu 并赋值给 NSApp.dockMenu。
/// 不走 Tauri Menu API（其未公开设置 dockMenu 的稳定入口），
/// 每次重建 menu 重新设，确保数据最新。
///
/// 菜单项点击通过 NSMenuItem.target/action 路由到 Tauri AppHandle.emit("menu://dock")
/// 前端根据 item id 决定动作（切换工作区 / 打开文件）。
#[cfg(target_os = "macos")]
fn set_dock_menu_macos(state: DockStatePayload, app: &AppHandle) {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::{NSString, MainThreadMarker};

    let mtm = match MainThreadMarker::new() {
        Some(m) => m,
        None => return, // 必须在主线程
    };

    unsafe {
        let nsmenu_class = AnyClass::get(c"NSMenu").expect("NSMenu class");
        let menu: *mut AnyObject = msg_send![nsmenu_class, alloc];
        let menu: *mut AnyObject = msg_send![menu, init];

        // 标题（菜单栏可见，macOS 不显示 dock 菜单标题但需保活）
        let title = NSString::from_str("Miro Code");
        let _: () = msg_send![menu, setTitle: &*title];

        // --- 最近项目子菜单 ---
        let label_recent = NSString::from_str("最近项目");
        let item_recent: *mut AnyObject = msg_send![nsmenu_class, alloc];
        let item_recent: *mut AnyObject = msg_send![item_recent, initWithTitle: &*label_recent, action: std::ptr::null::<AnyObject>(), keyEquivalent: &*NSString::from_str("")];
        let submenu_class = AnyClass::get(c"NSMenu").expect("NSMenu class");
        let sub: *mut AnyObject = msg_send![submenu_class, alloc];
        let sub: *mut AnyObject = msg_send![sub, initWithTitle: &*label_recent];

        if state.recent.is_empty() {
            let empty_label = NSString::from_str("（无）");
            let empty_item: *mut AnyObject = msg_send![nsmenu_class, alloc];
            let empty_item: *mut AnyObject = msg_send![empty_item, initWithTitle: &*empty_label, action: std::ptr::null::<AnyObject>(), keyEquivalent: &*NSString::from_str("")];
            let _: () = msg_send![empty_item, setEnabled: false];
            let _: () = msg_send![sub, addItem: empty_item];
        } else {
            for (idx, path) in state.recent.iter().take(8).enumerate() {
                let basename = std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(path);
                let display = if path.len() > 60 {
                    format!("{}…  {}", &basename[..basename.len().min(20)], &path[..path.len().min(50)])
                } else {
                    format!("{}  {}", basename, path)
                };
                let label = NSString::from_str(&display);
                let item: *mut AnyObject = msg_send![nsmenu_class, alloc];
                let item: *mut AnyObject = msg_send![item, initWithTitle: &*label, action: std::ptr::null::<AnyObject>(), keyEquivalent: &*NSString::from_str("")];
                // 用 representedObject 携带 path 字符串（点击拦截暂未实现，先用 tag 标识）
                let repr = NSString::from_str(path);
                let _: () = msg_send![item, setRepresentedObject: &*repr];
                // tag 存 index（保留接口供未来菜单事件拦截扩展）
                let _: () = msg_send![item, setTag: idx as isize];
                let _: () = msg_send![item, setEnabled: true];
                let _: () = msg_send![sub, addItem: item];
            }
        }
        let _: () = msg_send![item_recent, setSubmenu: sub];
        let _: () = msg_send![menu, addItem: item_recent];

        // --- 分隔线 ---
        let sep_class = AnyClass::get(c"NSMenuItem").expect("NSMenuItem class");
        // NSMenuItem.separatorItem 静态方法
        let sep: *mut AnyObject = msg_send![sep_class, separatorItem];
        let _: () = msg_send![menu, addItem: sep];

        // --- 当前文件 ---
        if let Some(path) = state.current_file.as_deref() {
            let basename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path);
            let display = if path.len() > 60 {
                format!("当前：{}…", &basename[..basename.len().min(40)])
            } else {
                format!("当前：{}", basename)
            };
            let label = NSString::from_str(&display);
            let item: *mut AnyObject = msg_send![nsmenu_class, alloc];
            let item: *mut AnyObject = msg_send![item, initWithTitle: &*label, action: std::ptr::null::<AnyObject>(), keyEquivalent: &*NSString::from_str("")];
            let _: () = msg_send![item, setEnabled: false]; // 仅显示，不可点
            let _: () = msg_send![menu, addItem: item];
        }

        // 赋值给 NSApp.dockMenu
        let nsapp_class = AnyClass::get(c"NSApplication").expect("NSApplication class");
        let raw: *mut AnyObject = msg_send![nsapp_class, sharedApplication];
        if !raw.is_null() {
            let app_ns: &AnyObject = &*raw;
            // setDockMenu: setter（macOS 11+）
            let _: () = msg_send![app_ns, setDockMenu: menu];
        }
    }

    let _ = mtm; // 抑制警告
    let _ = app; // 暂未使用（click 事件通过前端 emit 协调）
}
#[cfg(not(target_os = "macos"))]
fn set_dock_menu_macos(_state: DockStatePayload, _app: &AppHandle) {}

/// Tauri command：前端 emit 当前 recent + currentFile，Rust 重建 Dock 菜单。
#[tauri::command]
fn set_dock_menu(app: AppHandle, state: DockStatePayload) -> Result<(), String> {
    set_dock_menu_macos(state, &app);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 窗口位置/大小/最大化状态自动恢复（多窗口）。
        // SaveFlags 默认即位置+大小+最大化+装饰可见性，存到 app_data_dir。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(commands::ssh::SshState::default())
        .manage(commands::lsp::LspManager::default())
        .setup(|app| {
            let handle = app.handle();

            // 启动默认中文菜单；前端读到 settings.locale 后会再同步一次
            let menu = build_app_menu(handle, "zh-CN")?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let _ = app.emit("menu://action", event.id().as_ref());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            });

            // macOS：Overlay 标题栏底色 + 红绿灯同步（主题切换时前端会再同步底色）
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = commands::window_chrome::apply_titlebar_background(
                    &window, 232.0, 234.0, 239.0,
                );
                commands::window_chrome::install_traffic_light_hooks(&window);
            }

            // 启动后立即把 App 拉到最前（解决自动更新后需手动点 dock 才能前置的体验问题）。
            // 注意：不能在 setup 闭包里调 NSApp.setActivationPolicy() —— tao 0.35 的
            // did_finish_launching -> AppState::launched 内部还有 apply_activation_policy()
            // 会再设一次，setup 阶段手动 set 跟 tao 内部第二次设的时序会触发
            // `MainThreadMarker::new().unwrap()` 跨 extern "C" 边界 panic，
            // 被 abort 转成 "panic in a function that cannot unwind"。
            // 拉前动作改由前端 AppShell mount 时调 getCurrentWindow().setFocus() 实现。
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_app_menu_locale,
            set_dock_menu,
            commands::fs::list_dir,
            commands::fs::read_text_file,
            commands::fs::read_file_base64,
            commands::fs::write_text_file,
            commands::fs::create_entry,
            commands::fs::rename_entry,
            commands::fs::delete_entry,
            commands::fs::copy_entry,
            commands::fs::path_exists,
            commands::search::search_files,
            commands::search::search_content,
            commands::search::replace_in_files,
            commands::git::git_status,
            commands::git::git_init,
            commands::git::git_set_remote,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_create_branch,
            commands::git::git_delete_branch,
            commands::git::git_rename_branch,
            commands::git::git_log,
            commands::git::git_diff,
            commands::git::git_file_sides,
            commands::git::git_conflict_sides,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_stored_username,
            commands::git::git_fetch,
            commands::git::git_update_project,
            commands::git::git_rebase_branch,
            commands::git::git_rebase_status,
            commands::git::git_rebase_continue,
            commands::git::git_rebase_abort,
            commands::git::git_rebase_skip,
            commands::git::git_rebase_plan,
            commands::git::git_rebase_interactive,
            commands::git::git_cherry_pick,
            commands::git::git_reset,
            commands::git::git_blame,
            commands::git::git_remotes,
            commands::git::git_unpushed_commits,
            commands::git::git_set_upstream,
            commands::git::git_checkout_remote,
            commands::git::git_checkout_commit,
            commands::git::git_create_branch_at,
            commands::git::git_delete_remote_branch,
            commands::git::git_branch_sides,
            commands::git::git_stash,
            commands::git::git_stash_list,
            commands::git::git_stash_pop,
            commands::git::git_stash_apply,
            commands::git::git_stash_drop,
            commands::git::git_discard_paths,
            commands::git::git_reset_hard,
            commands::git::git_undo_commit,
            commands::git::git_revert_to,
            commands::git::git_revert_commit,
            commands::git::git_merge_branch,
            commands::git::git_conflict_files,
            commands::git::git_resolve_conflict,
            commands::ssh::ssh_shell_open,
            commands::ssh::ssh_shell_write,
            commands::ssh::ssh_shell_resize,
            commands::ssh::ssh_shell_close,
            commands::ssh::ssh_profiles_load,
            commands::ssh::ssh_profiles_save,
            commands::ssh::ssh_secret_get,
            commands::ssh::ssh_secret_set,
            commands::ssh::ssh_secret_remove,
            commands::tooling::format_with_prettier,
            commands::security_scoped::create_security_scoped_bookmarks,
            commands::security_scoped::resolve_security_scoped_bookmarks,
            commands::security_scoped::release_security_scoped_bookmarks,
            commands::lsp::lsp_check_runtime,
            commands::lsp::lsp_start,
            commands::lsp::lsp_send_request,
            commands::lsp::lsp_send_notification,
            commands::lsp::lsp_send_response,
            commands::lsp::lsp_stop,
            commands::lsp::lsp_stop_all,
            commands::lsp::lsp_list_servers,
            // 内置语言服务捆绑包（一键安装 / 卸载 / 状态）
            commands::language_services::ls_status,
            commands::language_services::ls_install,
            commands::language_services::ls_uninstall,
            // AI 行内智能补全
            commands::ai::ai_secret_get,
            commands::ai::ai_secret_set,
            commands::ai::ai_secret_remove,
            commands::ai::ai_complete_stream,
            commands::ai::ai_cancel,
            commands::window_chrome::set_titlebar_background,
            commands::window_chrome::sync_traffic_lights,
            // dev-only：模拟"push 卡住 N ms"，让 __ipcSelfCheck 在真机
            // 量化"卡住期间并发 IPC 的最大耗时"。release 构建下函数立即返回错误。
            commands::git::dev_fake_block,
        ])
        .on_window_event(|window, event| {
            // 窗口关闭时清理 LSP 进程（避免子进程孤儿）
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<commands::lsp::LspManager>() {
                    let state = state.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = commands::lsp::lsp_stop_all_inner(&state).await;
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
