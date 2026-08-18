// 原生文件拖拽（macOS NSDraggingSession）：
// 把图标以“真实 .svg 文件”拖出应用——拖到桌面 = Finder 复制文件，
// 拖到 Figma/VS Code/浏览器 = 目标按文件接收（Figma 直接矢量可编辑）。
//
// 背景：WKWebView 的网页拖拽只能携带文本 flavor（位图/文件项到不了系统），
// Finder 与 Figma 都不认 data: URI。因此这里在拖拽瞬间由 Rust 层接管：
//   1) 把 SVG 写入系统临时目录
//   2) 构造 NSPasteboard(public.file-url) + NSDraggingItem(图标 PNG 作拖影)
//   3) 在鼠标位置合成 NSEvent，由窗口 contentView 发起 NSDraggingSession
// 之后完全交给系统：拖到哪、文件就到哪，弹窗一概没有。
//
// Windows/Linux：objc2 仅 macOS 可用，原生拖拽代码全部 #[cfg(target_os = "macos")]
// 门控；前端在 Windows(WebView2) 走 Chromium 的 File 项拖出通道。

use std::fs;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
use {
    objc2_foundation::{
        MainThreadMarker, NSArray, NSData, NSObject, NSObjectProtocol, NSPoint, NSRect, NSString,
        NSSize,
    },
    objc2::rc::Retained,
    objc2::runtime::ProtocolObject,
    objc2::{define_class, msg_send, AnyThread, MainThreadOnly},
    objc2_app_kit::{
        NSDraggingContext, NSDraggingItem, NSDraggingSession, NSDraggingSource, NSDragOperation,
        NSEvent, NSEventModifierFlags, NSEventType, NSImage, NSPasteboardItem,
        NSPasteboardTypeFileURL, NSWindow,
    },
    tauri::{AppHandle, WebviewWindow},
};

fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(80)
        .collect();
    if cleaned.is_empty() { "icon".to_string() } else { cleaned }
}

/// 去重写入：path 已存在则追加 (n)。
fn dedupe_path(dir: &PathBuf, stem: &str, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    path
}

// ==================== macOS 原生拖拽（仅 macOS 编译） ====================

/// 把 SVG 写入系统临时目录，返回 file:// URL。
#[cfg(target_os = "macos")]
fn write_temp_svg(file_name: &str, svg: &str) -> Result<String, String> {
    let dir = std::env::temp_dir().join("icones-desktop-drag");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let p = std::path::Path::new(file_name);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "icon".to_string());
    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "svg".to_string());
    let base = safe_file_name(&stem);
    let path = dedupe_path(&dir, &base, &ext);
    fs::write(&path, svg).map_err(|e| e.to_string())?;

    let raw = path.to_str().ok_or("path not utf8")?;
    Ok("file://".to_string() + &raw.replace(' ', "%20"))
}

// ---- NSDraggingSource 实现：拖拽期间返回 Copy 操作 ----
#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    struct DragSource;

    unsafe impl NSObjectProtocol for DragSource {}

    unsafe impl NSDraggingSource for DragSource {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn draggingSession_sourceOperationMaskForDraggingContext(
            &self,
            _session: &NSDraggingSession,
            _context: NSDraggingContext,
        ) -> NSDragOperation {
            NSDragOperation::Copy | NSDragOperation::Link | NSDragOperation::Generic
        }
    }
);

/// 发起原生文件拖拽（仅 macOS）。
/// file_name：带扩展名（如 home.svg）；png_b64：拖拽预览图（可选，SVG 光栅 PNG）；
/// screen_x / screen_y：当前鼠标的屏幕坐标（逻辑像素）。
#[cfg(target_os = "macos")]
#[tauri::command]
fn start_file_drag(
    app: AppHandle,
    window: WebviewWindow,
    file_name: String,
    svg: String,
    png_b64: Option<String>,
    screen_x: f64,
    screen_y: f64,
) -> Result<(), String> {
    let file_url = write_temp_svg(&file_name, &svg)?;

    // 主线程发起拖拽会话（AppKit 对象全部在主线程创建，run_on_main_thread 要求 Send 闭包，
    // 故 AppKit 对象在闭包内构造）
    app.run_on_main_thread(move || {
        let _ = (|| -> Result<(), String> {
            let mt = MainThreadMarker::new().expect("main thread");
            let ns_window = unsafe {
                &*window.ns_window().map_err(|e| e.to_string())?.cast::<NSWindow>()
            };

            // 1) pasteboard 数据：public.file-url（Finder / Figma 都认）
            let pb_item = NSPasteboardItem::new();
            pb_item.setString_forType(
                &NSString::from_str(&file_url),
                unsafe { NSPasteboardTypeFileURL },
            );

            // 2) 拖拽预览图（图标 PNG）
            let image: Option<Retained<NSImage>> = png_b64
                .and_then(|b64| {
                    use base64::Engine;
                    base64::engine::general_purpose::STANDARD
                        .decode(b64)
                        .ok()
                        .map(|bytes| NSData::with_bytes(&bytes))
                })
                .and_then(|data| unsafe { NSImage::initWithData(NSImage::alloc(), &data) });

            // 3) 合成鼠标事件（位置 = 当前光标屏幕坐标）
            let screen_point = NSPoint::new(screen_x, screen_y);
            let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                NSEventType::LeftMouseDown,
                screen_point,
                NSEventModifierFlags::empty(),
                0.0,
                ns_window.windowNumber(),
                None,
                0,
                1,
                1.0,
            )
            .ok_or_else(|| "event failed".to_string())?;

            // 4) 拖拽项目：pasteboard writer + 拖影
            let dragging_item = NSDraggingItem::initWithPasteboardWriter(
                NSDraggingItem::alloc(),
                ProtocolObject::from_ref(&*pb_item),
            );
            let view_point = ns_window.convertPointFromScreen(screen_point);
            let frame = NSRect::new(
                NSPoint::new(view_point.x - 24.0, view_point.y - 24.0),
                NSSize::new(48.0, 48.0),
            );
            unsafe {
                dragging_item.setDraggingFrame_contents(
                    frame,
                    image.as_deref().map(|img| img as &objc2::runtime::AnyObject),
                );
            }

            // 5) 发起会话（源对象被系统持有直至拖拽结束）
            let source: Retained<DragSource> = unsafe {
                let this = DragSource::alloc(mt).set_ivars(());
                msg_send![super(this), init]
            };
            let items = NSArray::from_retained_slice(&[dragging_item]);
            let view = ns_window.contentView().ok_or_else(|| "no content view".to_string())?;
            let _session = view.beginDraggingSessionWithItems_event_source(
                &items,
                &event,
                ProtocolObject::from_ref(&*source),
            );
            Ok(())
        })();
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ==================== 跨平台导出（面板 Download / 保存到桌面） ====================

/// 把 SVG 写入指定位置，返回绝对路径。
/// location: "Desktop" / "Downloads" / "temp"；文件名自动去重。
#[tauri::command]
fn save_svg_export(file_name: String, svg: String, location: String) -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "HOME/USERPROFILE not set")?;
    let dir = match location.as_str() {
        "Downloads" => PathBuf::from(&home).join("Downloads"),
        "temp" => std::env::temp_dir().join("icones-desktop-drag"),
        _ => PathBuf::from(&home).join("Desktop"),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let p = std::path::Path::new(&file_name);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "icon".to_string());
    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "svg".to_string());
    let base = safe_file_name(&stem);
    let path = dedupe_path(&dir, &base, &ext);
    fs::write(&path, svg).map_err(|e| e.to_string())?;
    path.to_str().map(str::to_string).ok_or_else(|| "path not utf8".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            #[cfg(target_os = "macos")]
            start_file_drag,
            save_svg_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}