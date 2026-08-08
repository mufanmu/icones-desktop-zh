// 应用版本检测与更新提示：读取本地版本号 + 查询 GitHub 最新 release。
// 仅做检测与跳转，不自动下载、不 git pull（与仓库定位保持一致）。

export const REPO = "mufanmu/icones-desktop-zh";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** fetch 带超时：国内访问 api.github.com 常超时/被墙，避免请求无限挂起。 */
async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

/** 版本号比较：去 v 前缀后按数字主段逐段比较。a > b 返回正数，a < b 返回负数。 */
export function compareVersions(a: string, b: string): number {
  const pa = (a || "").replace(/^v/i, "").split(".").map((s) => parseInt(s, 10) || 0);
  const pb = (b || "").replace(/^v/i, "").split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 获取本地应用版本号：Tauri 运行时走原生 getVersion，浏览器 dev 走 package.json。 */
export async function getAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      /* fall through to pkg */
    }
  }
  try {
    const pkg = (await import("../../package.json")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** 查询 GitHub 最新 release 版本号（tag_name 去 v 前缀）。任何失败（无 release/限流/断网）返回 null。 */
async function latestFromApi(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(GITHUB_API, 8000);
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    if (!data.tag_name) return null;
    return data.tag_name.replace(/^v/i, "");
  } catch {
    return null;
  }
}

/** 兜底源1：github.com 网页 releases/latest，跟随重定向后从最终 URL 提取 tag。
 *  国内 api.github.com 常被墙但 github.com 网页通常可访问，用它做 fallback。 */
async function latestFromWeb(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`https://github.com/${REPO}/releases/latest`, 8000);
    const m = res.url.match(/\/releases\/tag\/([^/?]+)/);
    if (m) return m[1].replace(/^v/i, "");
    const html = await res.text();
    const m2 = html.match(/releases\/tag\/(v?[\w.-]+)/);
    return m2 ? m2[1].replace(/^v/i, "") : null;
  } catch {
    return null;
  }
}

/** 兜底源2：releases.atom(RSS)。与 github.com 同域名，可达性与下载页一致。 */
async function latestFromAtom(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`https://github.com/${REPO}/releases.atom`, 8000);
    const xml = await res.text();
    const m = xml.match(/<link[^>]*href="[^"]*\/releases\/tag\/([^"]+)"/);
    return m ? m[1].replace(/^v/i, "") : null;
  } catch {
    return null;
  }
}

export async function fetchLatestRelease(): Promise<string | null> {
  // 主源 api.github.com（浏览器/Tauri 均无 CORS 问题）；失败后仅在 Tauri 环境
  // 尝试 github.com 网页/atom 兜底（浏览器 dev 下这两个源有 CORS 限制，跳过）。
  const api = await latestFromApi();
  if (api) return api;
  if (!isTauri()) return null;
  return (await latestFromWeb()) ?? (await latestFromAtom());
}

// 模块级单例：session 内只查一次，避免 StrictMode 双调 / 反复切换触发多余请求。
let checkCache: Promise<string | null> | null = null;

// 测试模拟开关：URL 带 ?simulate-update=1 时，模拟存在一个新版本（用于预览「有新版本」按钮 UI）。
// 不带该参数时行为完全正常（走真实 GitHub API 检测）。
const SIMULATED_LATEST = "0.2.0";

function isSimulateMode(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("simulate-update")
  );
}

/** 检测是否有新版本：有新版本返回最新版本号（如 "0.2.0"），无新版/失败返回 null。 */
export function checkForUpdates(): Promise<string | null> {
  if (!checkCache) {
    checkCache = (async () => {
      if (isSimulateMode()) {
        const local = await getAppVersion();
        return compareVersions(SIMULATED_LATEST, local) > 0 ? SIMULATED_LATEST : null;
      }
      const [latest, local] = await Promise.all([fetchLatestRelease(), getAppVersion()]);
      if (!latest) return null;
      return compareVersions(latest, local) > 0 ? latest : null;
    })().catch(() => null);
  }
  return checkCache;
}

/** 在外部浏览器打开链接（Tauri 走系统默认浏览器，浏览器环境走新标签页）。 */
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
