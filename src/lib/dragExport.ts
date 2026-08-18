// 图标拖拽导出：macOS 原生文件拖拽（NSDraggingSession）。
//
// WKWebView 的网页拖拽只能带文本 flavor（位图/文件项到不了系统），Finder 与
// Figma 都不认 data: URI。因此拖拽瞬间由 Rust 层接管：把 SVG 写成临时文件、
// 以 public.file-url 发起原生拖拽会话——拖到桌面 = Finder 收文件，拖到
// Figma/VS Code = 目标按 .svg 文件接收（Figma 直接矢量可编辑）。
// 拖到哪、数据到哪，不弹窗、不预写桌面。

import type React from "react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type SaveLocation = "Desktop" | "Downloads" | "temp";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 调 Rust：把内容写入某位置（面板 Download / 保存用），返回绝对路径。 */
export async function saveSvgFile(
  fileName: string,
  content: string,
  location: SaveLocation = "Downloads",
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("save_svg_export", { fileName, svg: content, location });
  } catch {
    return null;
  }
}

// ---- 主题颜色单例订阅（网格 200+ 图标共享一个 MutationObserver） ----
let themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | null = null;
function ensureThemeObserver() {
  if (themeObserver) return;
  themeObserver = new MutationObserver(() => {
    themeListeners.forEach((fn) => fn());
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
export function subscribeThemeColor(fn: () => void): () => void {
  ensureThemeObserver();
  themeListeners.add(fn);
  return () => {
    themeListeners.delete(fn);
  };
}
/** React hook：当前主题下的主体文本色。 */
export function useThemeColor(): string {
  const [color, setColor] = useState<string>(() => {
    try {
      return getComputedStyle(document.body).color || "#ffffff";
    } catch {
      return "#ffffff";
    }
  });
  useEffect(
    () =>
      subscribeThemeColor(() => {
        try {
          setColor(getComputedStyle(document.body).color || "#ffffff");
        } catch {
          /* ignore */
        }
      }),
    [],
  );
  return color;
}

export const DATA_URI_PREFIX = "data:image/svg+xml;charset=utf-8,";

/** 按主题把 currentColor 烘成具体颜色，生成 SVG data URI。 */
export function svgDataUri(svg: string, color?: string | null): string {
  const colored = color && color !== "currentColor" ? svg.replaceAll("currentColor", color) : svg;
  return DATA_URI_PREFIX + encodeURIComponent(colored);
}

// ---- 光栅化：SVG → PNG data URI（原生拖拽的预览图；按 name+color 缓存） ----
const pngCache = new Map<string, Promise<string>>();

export function rasterize(svg: string, color: string, size: number): Promise<string> {
  const key = `${size}|${color}|${svg.length}`;
  const hit = pngCache.get(key);
  if (hit) return hit;
  const p = new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(c.toDataURL("image/png"));
      } catch (err) {
        reject(err as Error);
      }
    };
    img.onerror = () => reject(new Error("svg decode failed"));
    img.src = svgDataUri(svg, color);
  });
  pngCache.set(key, p);
  return p;
}

/**
 * 发起原生文件拖拽（拖拽源事件上调用）：
 * 取消 webview 的空拖拽 → 光栅化 PNG 拖影 → 把 SVG 写成临时文件并启动
 * NSDraggingSession。之后系统接管，拖到哪文件就到哪。
 */
export async function startNativeFileDrag(
  e: React.DragEvent,
  svg: string,
  name: string,
): Promise<void> {
  if (!svg) return;
  e.preventDefault(); // 取消 webview 自带的空拖拽
  if (!isTauri()) return;
  const short = name.split(":").pop() ?? name;
  try {
    // 拖拽预览图（主题色烘烤）
    const color = getComputedStyle(document.body).color || "#ffffff";
    const png = await rasterize(svg, color, 128);
    const b64 = png.includes(",") ? png.split(",")[1] : null;

    // 鼠标屏幕坐标 = 窗口位置 + 视图内坐标 × 缩放
    const win = getCurrentWindow();
    const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    const screenX = pos.x + e.clientX * scale;
    const screenY = pos.y + e.clientY * scale;

    await invoke("start_file_drag", {
      fileName: `${short}.svg`,
      svg,
      pngB64: b64,
      screenX,
      screenY,
    });
  } catch {
    /* 原生拖拽失败时静默（保留 webview 默认行为由系统兜底） */
  }
}