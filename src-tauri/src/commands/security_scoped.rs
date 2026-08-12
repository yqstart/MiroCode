//! macOS security-scoped bookmark
//!
//! 解决自动更新替换 bundle 后 macOS TCC 撤销"是否允许访问文件夹"授权的问题。
//!
//! 流程：
//! 1. 用户首次 NSOpenPanel 选工作区时，前端调 `create_security_scoped_bookmarks(path)`，
//!    用 `NSURL.bookmarkData(options: .withSecurityScope, ...)` 写一个 security-scoped bookmark，
//!    序列化为 base64 返回给前端。
//! 2. 前端存到 localStorage（key = path）。
//! 3. 下次启动 `restoreLastFolder` 调 `resolve_security_scoped_bookmarks(path, bookmark_b64)`，
//!    还原 NSURL + `startAccessingSecurityScopedResource()`，让接下来的 listDir / readFile
//!    不再被 TCC 弹问。
//! 4. `release_security_scoped_bookmarks` 走 `stopAccessingSecurityScopedResource()`。
//!
//! 非 macOS 平台三个命令都返回 no-op（false / 空）。

use base64::Engine;

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    /// NSURL.BookmarkCreationOptions: withSecurityScope = 1 << 11 = 2048
    const NS_URL_BOOKMARK_CREATION_WITH_SECURITY_SCOPE: u64 = 1 << 11;

    /// 路径 -> base64(bookmarkData)
    pub fn create(path: &str) -> Result<Option<String>, String> {
        unsafe {
            let url_class = AnyClass::get(c"NSURL").ok_or("NSURL class not found")?;
            // [NSURL fileURLWithPath:]
            let url: *mut AnyObject = msg_send![url_class, fileURLWithPath: &*NSString::from_str(path)];
            if url.is_null() {
                return Err("fileURLWithPath 返回 null".into());
            }
            // [url bookmarkDataWithOptions:includingResourceValuesForKeys:relativeToURL:error:]
            // 错误用 NSError** 指针（第 4 个参数）
            let mut err: *mut AnyObject = std::ptr::null_mut();
            let data: *mut AnyObject = msg_send![
                &*url,
                bookmarkDataWithOptions: NS_URL_BOOKMARK_CREATION_WITH_SECURITY_SCOPE,
                includingResourceValuesForKeys: std::ptr::null::<AnyObject>(),
                relativeToURL: std::ptr::null::<AnyObject>(),
                error: &mut err
            ];
            if data.is_null() {
                let msg = if !err.is_null() {
                    let desc: *mut AnyObject = msg_send![&*err, localizedDescription];
                    if !desc.is_null() {
                        let utf8: *const i8 = msg_send![&*desc, UTF8String];
                        if !utf8.is_null() {
                            std::ffi::CStr::from_ptr(utf8)
                                .to_string_lossy()
                                .into_owned()
                        } else {
                            "unknown error".to_string()
                        }
                    } else {
                        "unknown error".to_string()
                    }
                } else {
                    "unknown error".to_string()
                };
                return Err(msg);
            }
            // 把 NSData 转 base64
            let length: usize = msg_send![&*data, length];
            let bytes: *const u8 = msg_send![&*data, bytes];
            if bytes.is_null() || length == 0 {
                return Ok(None);
            }
            let slice = std::slice::from_raw_parts(bytes, length);
            let b64 = base64::engine::general_purpose::STANDARD.encode(slice);
            Ok(Some(b64))
        }
    }

    /// (base64_bookmark, 路径) -> NSURL 还原 + startAccessingSecurityScopedResource
    pub fn resolve(bookmark_b64: &str, path: &str) -> Result<bool, String> {
        unsafe {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bookmark_b64)
                .map_err(|e| format!("bookmark base64 解码失败: {e}"))?;
            let data_class = AnyClass::get(c"NSData").ok_or("NSData class not found")?;
            let ns_data_alloc: *mut AnyObject = msg_send![data_class, alloc];
            let ns_data: *mut AnyObject = msg_send![
                ns_data_alloc,
                initWithBytes: bytes.as_ptr(),
                length: bytes.len()
            ];
            if ns_data.is_null() {
                return Err("NSData 初始化失败".into());
            }
            // 用 [NSURL URLByResolvingBookmarkData:options:relativeToURL:bookmarkDataIsStale:error:]
            let url_class = AnyClass::get(c"NSURL").ok_or("NSURL class not found")?;
            let mut err: *mut AnyObject = std::ptr::null_mut();
            // BookmarkResolutionOptions: withSecurityScope = 1 << 10 = 1024
            let opts: u64 = 1 << 10;
            let is_stale: *mut AnyObject = std::ptr::null_mut();
            let url: *mut AnyObject = msg_send![
                url_class,
                URLByResolvingBookmarkData: &*ns_data,
                options: opts,
                relativeToURL: std::ptr::null::<AnyObject>(),
                bookmarkDataIsStale: is_stale,
                error: &mut err
            ];
            if url.is_null() {
                let msg = if !err.is_null() {
                    let desc: *mut AnyObject = msg_send![&*err, localizedDescription];
                    if !desc.is_null() {
                        let utf8: *const i8 = msg_send![&*desc, UTF8String];
                        if !utf8.is_null() {
                            std::ffi::CStr::from_ptr(utf8)
                                .to_string_lossy()
                                .into_owned()
                        } else {
                            "unknown error".to_string()
                        }
                    } else {
                        "unknown error".to_string()
                    }
                } else {
                    "unknown error".to_string()
                };
                return Err(msg);
            }
            // 验证 path 是否匹配
            let url_path: *mut AnyObject = msg_send![&*url, path];
            if !url_path.is_null() {
                let url_path_str: *const i8 = msg_send![&*url_path, UTF8String];
                if !url_path_str.is_null() {
                    let url_path_cstr = std::ffi::CStr::from_ptr(url_path_str);
                    let url_path_str = url_path_cstr.to_string_lossy();
                    if url_path_str != path {
                        return Err(format!(
                            "bookmark 与路径不匹配: bookmark={url_path_str} path={path}"
                        ));
                    }
                }
            }
            // startAccessingSecurityScopedResource 返回 Bool
            let ok: bool = msg_send![&*url, startAccessingSecurityScopedResource];
            if !ok {
                return Err("startAccessingSecurityScopedResource 返回 false".into());
            }
            // 保留 NSURL 防止 ARC 立刻释放：把指针存到 thread-local Vec
            // （实际由 release_* 调 stopAccessingSecurityScopedResource 对应释放）
            ACTIVE_URLS.with(|cell| {
                cell.borrow_mut().push(url as usize);
            });
            Ok(true)
        }
    }

    /// 释放所有已激活的 security-scoped URL（close 路径调）
    pub fn release_all() {
        ACTIVE_URLS.with(|cell| {
            for ptr in cell.borrow().iter() {
                unsafe {
                    let url: &AnyObject = &*(*ptr as *const AnyObject);
                    let _: () = msg_send![url, stopAccessingSecurityScopedResource];
                }
            }
            cell.borrow_mut().clear();
        });
    }

    use std::cell::RefCell;
    thread_local! {
        static ACTIVE_URLS: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn create_security_scoped_bookmarks(path: String) -> Result<Option<String>, String> {
    macos::create(&path)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn resolve_security_scoped_bookmarks(path: String, bookmark: String) -> Result<bool, String> {
    macos::resolve(&bookmark, &path)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn release_security_scoped_bookmarks() {
    macos::release_all();
}

// 非 macOS 桩（避免 Tauri 注册漏函数报错）
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn create_security_scoped_bookmarks(_path: String) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn resolve_security_scoped_bookmarks(_path: String, _bookmark: String) -> Result<bool, String> {
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn release_security_scoped_bookmarks() {}
