//! macOS Overlay 标题栏：底色 + 红绿灯垂直居中

use tauri::WebviewWindow;

/// CSS 端 `--titlebar-height: 38px`；macOS 上 1 CSS px = 1 逻辑点（pt），
/// 与 backingScaleFactor 无关（Retina 屏 1pt = 2×2 物理像素，但 NSView 坐标始终用逻辑点）。
const TITLEBAR_HEIGHT: f64 = 38.0;
/// 红绿灯左侧边距（逻辑点）
const TRAFFIC_LIGHT_X: f64 = 14.0;
const SPACE_BETWEEN: f64 = 20.0;
const BUTTON_SIZE: f64 = 14.0;

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
        // 改底色会触发 AppKit 重排，立刻补一次红绿灯位置
        let _ = apply_traffic_lights(&window);
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

/// 按 TITLEBAR_HEIGHT 重排红绿灯，使其与前端 TitleBar 折叠按钮垂直对齐。
///
/// 说明：仅改 `trafficLightPosition.y` / 只拉高容器不够——AppKit 常把按钮贴在
/// 容器顶部，必须显式设 origin.y 才能与 CSS `align-items: center` 的折叠按钮同排。
/// 全屏时跳过，避免与系统全屏过渡动画抢布局。
#[cfg(target_os = "macos")]
pub fn apply_traffic_lights(window: &WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton, NSWindowStyleMask};
    use objc2_foundation::NSPoint;

    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    if ns_window_ptr.is_null() {
        return Err("无法获取 NSWindow".into());
    }
    // SAFETY: ns_window 由 Tauri 持有，窗口存活期内指针有效
    let ns_window = unsafe { &*ns_window_ptr };

    // 全屏过渡中 AppKit 接管按钮布局，强行 setFrame 会造成跳动
    if ns_window
        .styleMask()
        .contains(NSWindowStyleMask::FullScreen)
    {
        return Ok(());
    }

    let close = ns_window
        .standardWindowButton(NSWindowButton::CloseButton)
        .ok_or_else(|| "无关闭按钮".to_string())?;
    let miniaturize = ns_window
        .standardWindowButton(NSWindowButton::MiniaturizeButton)
        .ok_or_else(|| "无最小化按钮".to_string())?;
    let zoom = ns_window
        .standardWindowButton(NSWindowButton::ZoomButton)
        .ok_or_else(|| "无缩放按钮".to_string())?;

    // 标题栏容器：把高度对齐前端 --titlebar-height，origin 在 AppKit 中为左下角。
    // 缺少这一步，AppKit 容器可能保持默认高度，红绿灯无法正确居中。
    let title_bar_container = unsafe {
        close
            .superview()
            .and_then(|v| v.superview())
            .ok_or_else(|| "无标题栏容器".to_string())?
    };
    let mut title_bar_rect = NSView::frame(&*title_bar_container);
    title_bar_rect.size.height = TITLEBAR_HEIGHT;
    title_bar_rect.origin.y = ns_window.frame().size.height - TITLEBAR_HEIGHT;
    title_bar_container.setFrame(title_bar_rect);

    // 用 setFrameOrigin 摆按钮（不触发容器 layout 反复重排）。
    // 按钮中心 = origin_y + button_h/2；令其等于 TITLEBAR_HEIGHT/2 居中：
    // origin_y = (TITLEBAR_HEIGHT - button_h) / 2。
    let close_rect = NSView::frame(&*close);
    let button_h = if close_rect.size.height > 0.0 {
        close_rect.size.height
    } else {
        BUTTON_SIZE
    };
    let origin_y = ((TITLEBAR_HEIGHT - button_h) / 2.0).round().max(0.0);
    // 实测按钮间距，未就绪时用兜底值
    let live_space_between = NSView::frame(&*miniaturize).origin.x - close_rect.origin.x;
    let space_between = if live_space_between > 0.0 {
        live_space_between
    } else {
        SPACE_BETWEEN
    };
    let buttons = [close, miniaturize, zoom];
    for (i, button) in buttons.iter().enumerate() {
        let origin = NSPoint::new(TRAFFIC_LIGHT_X + (i as f64 * space_between), origin_y);
        button.setFrameOrigin(origin);
    }

    Ok(())
}

/// 在窗口上安装红绿灯同步：启动延迟补齐 + 关键窗口事件重排。
#[cfg(target_os = "macos")]
pub fn install_traffic_light_hooks(window: &WebviewWindow) {
    use tauri::WindowEvent;

    // 立即调一次：button_h 已兜底 14 逻辑点，setup 阶段能拿到按钮 frame → 摆到正确位置
    let _ = apply_traffic_lights(window);
    // 后续仅在 Resized/ThemeChanged/ScaleFactorChanged 等真实事件触发时重排
    // —— 不再用 80/250/700/1600ms 延迟补排，避免与 Wry 持续 inset_traffic_lights 反复 setFrame 导致视觉抖动

    let win = window.clone();
    window.on_window_event(move |event| {
        if !matches!(
            event,
            WindowEvent::Resized(_)
                | WindowEvent::Focused(_)
                | WindowEvent::ThemeChanged(_)
                | WindowEvent::ScaleFactorChanged { .. }
        ) {
            return;
        }

        let _ = apply_traffic_lights(&win);
    });
}
