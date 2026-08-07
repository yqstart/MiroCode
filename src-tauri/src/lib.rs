use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Runtime,
};

mod commands;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::ssh::SshState::default())
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_app_menu_locale,
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
            commands::ssh::sftp_open,
            commands::ssh::sftp_list,
            commands::ssh::sftp_pwd,
            commands::ssh::sftp_upload,
            commands::ssh::sftp_download,
            commands::ssh::sftp_read,
            commands::ssh::sftp_write,
            commands::ssh::sftp_mkdir,
            commands::ssh::sftp_create_file,
            commands::ssh::sftp_rename,
            commands::ssh::sftp_remove,
            commands::ssh::sftp_close,
            commands::tooling::format_with_prettier,
            commands::tooling::lint_with_eslint,
            commands::window_chrome::set_titlebar_background,
            commands::window_chrome::sync_traffic_lights,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
