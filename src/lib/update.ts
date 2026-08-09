// 应用版本检测与更新提示：读取本地版本号 + 查询 GitHub 最新 release。
// 仅做检测与跳转，不自动下载、不 git pull（与仓库定位保持一致）。

export const REPO = "mufanmu/icones-desktop-zh";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RAW_PKG = `https://raw.githubusercontent.com/${REPO}/main/package.json`;
const JSDELIVR_PKG = `https://cdn.jsdelivr.net/gh/${REPO}@main/package.json`;

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

/** 最优先源：raw.githubusercontent.com 读 main 分支 package.json 的 version。
 *  实时无 CDN 缓存延迟、CORS *、国内走 Fastly CDN 可达性好。
 *  反映 main 分支当前版本（发版时 main 已更新），略提前于 release 发布，可接受。 */
async function latestFromRaw(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(RAW_PKG, 8000);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ? data.version.replace(/^v/i, "") : null;
  } catch {
    return null;
  }
}

/** 次优先源：jsDelivr CDN（带 @main 锁定分支，边缘缓存更新更及时）。CORS *，国内加速。 */
async function latestFromJsdelivr(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${JSDELIVR_PKG}?t=${Date.now()}`, 8000);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ? data.version.replace(/^v/i, "") : null;
  } catch {
    return null;
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

export async function fetchLatestRelease(): Promise<string | null> {
  // 优先 raw.githubusercontent.com（实时无缓存）；失败回退 jsDelivr CDN（@main，国内加速）；
  // 再失败回退 api.github.com（权威但国内常超时）。
  // 不再使用 github.com 网页/atom 兜底：WKWebView 原生 fetch 跨域被 CORS 拦截（假兜底）。
  const raw = await latestFromRaw();
  if (raw) return raw;
  const cdn = await latestFromJsdelivr();
  if (cdn) return cdn;
  return await latestFromApi();
}

// 模块级单例：session 内只查一次，避免 StrictMode 双调 / 反复切换触发多余请求。
// 注意：检测失败（网络超时等）时不缓存，允许下次重试；仅成功结果（含"无更新"）缓存。
let checkCache: Promise<string | null> | null = null;

/** 手动重置检测缓存：下次 checkForUpdates 会重新发请求。 */
export function resetUpdateCheck(): void {
  checkCache = null;
}

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
      if (!latest) {
        checkCache = null; // 网络失败不缓存，允许下次重试
        return null;
      }
      return compareVersions(latest, local) > 0 ? latest : null;
    })().catch(() => {
      checkCache = null; // 异常不缓存
      return null;
    });
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
