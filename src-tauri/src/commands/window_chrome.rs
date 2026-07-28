//! macOS Overlay 标题栏：底色 + 红绿灯垂直居中

use tauri::WebviewWindow;

/// 与前端 `--titlebar-height` 保持一致（逻辑像素）
pub const TITLEBAR_HEIGHT: f64 = 38.0;
/// 红绿灯左侧边距（逻辑像素）
pub const TRAFFIC_LIGHT_X: f64 = 14.0;

/// 设置 macOS 原生标题栏底色（r/g/b：0–255）。非 macOS 为空操作。
#[tauri::command]
pub fn set_titlebar_background(
    window: WebviewWindow,
    r: f64,
    g: f64,
    b: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        apply_titlebar_background(&window, r, g, b)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, r, g, b);
    }
    Ok(())
}

/// 将红绿灯垂直居中到 Overlay 标题栏。非 macOS 为空操作。
#[tauri::command]
pub fn sync_traffic_lights(window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        apply_traffic_lights(&window)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn apply_titlebar_background(
    window: &WebviewWindow,
    r: f64,
    g: f64,
    b: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSColor, NSWindow};

    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    if ns_window_ptr.is_null() {
        return Err("无法获取 NSWindow".into());
    }
    // SAFETY: ns_window 由 Tauri 持有，窗口存活期内指针有效
    let ns_window = unsafe { &*ns_window_ptr };
    let bg = NSColor::colorWithRed_green_blue_alpha(r / 255.0, g / 255.0, b / 255.0, 1.0);
    ns_window.setBackgroundColor(Some(&bg));
    Ok(())
}

/// 按 TITLEBAR_HEIGHT 重排红绿灯，使其与前端 TitleBar 按钮垂直对齐。
///
/// 说明：仅改 `trafficLightPosition.y` 不够可靠——tao 只拉高容器高度、不改按钮
/// origin.y，且 AppKit 布局后常把位置重置。这里显式设容器高度并垂直居中按钮。
#[cfg(target_os = "macos")]
pub fn apply_traffic_lights(window: &WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;

    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    if ns_window_ptr.is_null() {
        return Err("无法获取 NSWindow".into());
    }
    // SAFETY: ns_window 由 Tauri 持有，窗口存活期内指针有效
    let ns_window = unsafe { &*ns_window_ptr };

    let close = ns_window
        .standardWindowButton(NSWindowButton::CloseButton)
        .ok_or_else(|| "无关闭按钮".to_string())?;
    let miniaturize = ns_window
        .standardWindowButton(NSWindowButton::MiniaturizeButton)
        .ok_or_else(|| "无最小化按钮".to_string())?;
    let zoom = ns_window
        .standardWindowButton(NSWindowButton::ZoomButton)
        .ok_or_else(|| "无缩放按钮".to_string())?;

    let title_bar_container = unsafe {
        close
            .superview()
            .and_then(|v| v.superview())
            .ok_or_else(|| "无标题栏容器".to_string())?
    };

    let close_rect = NSView::frame(&*close);
    let button_h = close_rect.size.height;
    let space_between = NSView::frame(&*miniaturize).origin.x - close_rect.origin.x;

    // 容器高度对齐前端标题栏；origin 在 AppKit 中为左下角
    let mut title_bar_rect = NSView::frame(&*title_bar_container);
    title_bar_rect.size.height = TITLEBAR_HEIGHT;
    title_bar_rect.origin.y = ns_window.frame().size.height - TITLEBAR_HEIGHT;
    title_bar_container.setFrame(title_bar_rect);

    let origin_y = ((TITLEBAR_HEIGHT - button_h) / 2.0).round().max(0.0);

    let buttons = [close, miniaturize, zoom];
    for (i, button) in buttons.iter().enumerate() {
        let origin = NSPoint::new(TRAFFIC_LIGHT_X + (i as f64 * space_between), origin_y);
        button.setFrameOrigin(origin);
    }

    Ok(())
}
