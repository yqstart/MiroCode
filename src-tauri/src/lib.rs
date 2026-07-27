use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_pty::init())
        .manage(commands::ssh::SshState::default())
        .setup(|app| {
            let handle = app.handle();

            let open_folder =
                MenuItem::with_id(handle, "open_folder", "打开文件夹…", true, Some("CmdOrCtrl+O"))?;
            let save = MenuItem::with_id(handle, "save", "保存", true, Some("CmdOrCtrl+S"))?;
            let find_file =
                MenuItem::with_id(handle, "find_file", "查找文件…", true, Some("CmdOrCtrl+P"))?;
            let search =
                MenuItem::with_id(handle, "search", "在文件中查找…", true, Some("CmdOrCtrl+Shift+F"))?;
            let reveal_in_explorer = MenuItem::with_id(
                handle,
                "reveal_in_explorer",
                "在资源管理器中显示",
                true,
                Some("Alt+F1"),
            )?;
            let terminal =
                MenuItem::with_id(handle, "terminal", "打开终端", true, Some("CmdOrCtrl+`"))?;
            let settings = MenuItem::with_id(handle, "settings", "设置…", true, Some("CmdOrCtrl+,"))?;
            let separator = PredefinedMenuItem::separator(handle)?;
            let quit = PredefinedMenuItem::quit(handle, Some("退出 Miro Code"))?;

            let file_menu = Submenu::with_items(
                handle,
                "文件",
                true,
                &[
                    &open_folder,
                    &save,
                    &separator,
                    &find_file,
                    &search,
                    &reveal_in_explorer,
                    &terminal,
                    &separator,
                    &settings,
                    &quit,
                ],
            )?;

            let menu = Menu::with_items(handle, &[&file_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let _ = app.emit("menu://action", event.id().as_ref());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_dir,
            commands::fs::read_text_file,
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
            commands::git::git_stash,
            commands::git::git_stash_pop,
            commands::git::git_reset_hard,
            commands::git::git_undo_commit,
            commands::git::git_revert_to,
            commands::git::git_merge_branch,
            commands::git::git_conflict_files,
            commands::git::git_resolve_conflict,
            commands::ssh::ssh_shell_open,
            commands::ssh::ssh_shell_write,
            commands::ssh::ssh_shell_resize,
            commands::ssh::ssh_shell_close,
            commands::ssh::sftp_open,
            commands::ssh::sftp_list,
            commands::ssh::sftp_pwd,
            commands::ssh::sftp_upload,
            commands::ssh::sftp_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Miro Code");
}
