// Thin client over the public Iconify API (https://iconify.design/docs/api/).
// Same data source that powers icones.js.org — 200k+ icons, 150+ open sets.

const API = "https://api.iconify.design";

export interface CollectionMeta {
  prefix: string;
  name: string;
  total: number;
  author?: string;
  license?: string;
  category?: string;
  palette?: boolean; // true = has hardcoded colors, false = monochrome (currentColor)
  height?: number;
  samples?: string[];
}

export interface CollectionInfo {
  prefix: string;
  title: string;
  total: number;
  icons: string[]; // flat list of icon names (no prefix)
}

// ---- simple in-memory caches (session lifetime) ----
let collectionsCache: CollectionMeta[] | null = null;
const collectionCache = new Map<string, CollectionInfo>();

export async function fetchCollections(): Promise<CollectionMeta[]> {
  if (collectionsCache) return collectionsCache;
  const res = await fetch(`${API}/collections`);
  const raw = (await res.json()) as Record<string, any>;
  const list: CollectionMeta[] = Object.entries(raw).map(([prefix, v]) => ({
    prefix,
    name: v.name ?? prefix,
    total: v.total ?? 0,
    author: v.author?.name,
    license: v.license?.title,
    category: v.category ?? "Other",
    palette: v.palette ?? false,
    height: Array.isArray(v.height) ? v.height[0] : v.height,
    samples: v.samples,
  }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  collectionsCache = list;
  return list;
}

export async function fetchCollection(prefix: string): Promise<CollectionInfo> {
  const cached = collectionCache.get(prefix);
  if (cached) return cached;
  const res = await fetch(
    `${API}/collection?prefix=${encodeURIComponent(prefix)}`,
  );
  const data = (await res.json()) as any;

  // Icons can live under `uncategorized` and/or `categories: { cat: [...] }`.
  const names = new Set<string>();
  if (Array.isArray(data.uncategorized))
    data.uncategorized.forEach((n: string) => names.add(n));
  if (data.categories) {
    for (const arr of Object.values<string[]>(data.categories))
      arr.forEach((n) => names.add(n));
  }
  // Aliases are real, usable icon names too.
  if (data.aliases) Object.keys(data.aliases).forEach((n) => names.add(n));

  const info: CollectionInfo = {
    prefix,
    title: data.title ?? prefix,
    total: data.total ?? names.size,
    icons: [...names].sort(),
  };
  collectionCache.set(prefix, info);
  return info;
}

export interface SearchResult {
  icons: string[]; // full "prefix:name"
  total: number;
}

export async function searchIcons(
  query: string,
  limit = 120,
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { icons: [], total: 0 };
  const res = await fetch(
    `${API}/search?query=${encodeURIComponent(q)}&limit=${limit}`,
  );
  const data = (await res.json()) as any;
  const icons: string[] = data.icons ?? [];
  return { icons, total: data.total ?? icons.length };
}

// 联合搜索：主词（primary）与模糊词条（fuzzy）取全量并 round-robin 交错合并，
// 联想词（secondary，类目混合词条）每词仅取前几个补充——保证主词结果占绝对多数，
// 又不砍掉 fuzzy 场景（「首页/箭头」等）的结果量。
// 用于中文输入经 zh-dict 翻译后的多关键词场景（见 zhSearch.translateChineseFull）。
//
// 注意：Iconify search API 的 limit 参数最小值为 32（实测 limit=1/5/13 均返回 32+），
// 均分配额策略实际失效（每个词都返回全量），因此这里改为主词/fuzzy 全量 + 联想限量。
// 合并结果不按 limit 截断（仅防爆上限 MAX_MERGE），由 App 端 visible 分页显示——
// 这样中文并集搜索的「加载更多」才有效（旧实现 slice(0,limit) 把结果锁死在 200）。
const MAX_MERGE = 2000;
// fuzzy 词的取样上限：fuzzy 词条是变体名/关联词（home-2、file-search…），
// 它们在各集合的 API 结果序里靠前，少量即可覆盖主流集合；取满 limit 只会
// 给合并结果灌入数千条弱相关噪音（搜「箭头」时 "bottom" 一词带回整页
// align-bottom / panel-bottom）。主词仍取满 limit 保证召回。
const FUZZY_FETCH_LIMIT = 64;
export async function searchIconsMulti(
  primary: string[],
  secondary: string[] = [],
  fuzzy: string[] = [],
  limit = 120,
): Promise<SearchResult> {
  const p = primary.map((s) => s.trim()).filter(Boolean);
  const s = secondary.map((s) => s.trim()).filter(Boolean);
  const f = fuzzy.map((s) => s.trim()).filter(Boolean);
  if (p.length === 0 && s.length === 0 && f.length === 0)
    return { icons: [], total: 0 };
  if (p.length + s.length + f.length === 1) {
    const q = p[0] ?? s[0] ?? f[0];
    return searchIcons(q, limit);
  }

  // 主词 + fuzzy：每词取满 limit（API 实际返回全量/clamp 32），
  // round-robin 轮转交错合并，避免单个词的结果整块霸屏。
  const primaryResults = await Promise.all(
    p.map(async (q) => {
      try {
        return await searchIcons(q, limit);
      } catch {
        return { icons: [], total: 0 };
      }
    }),
  );
  const fuzzyResults = await Promise.all(
    f.map(async (q) => {
      try {
        return await searchIcons(q, FUZZY_FETCH_LIMIT);
      } catch {
        return { icons: [], total: 0 };
      }
    }),
  );
  // 联想词：每词仅取前 4 个（如搜「香蕉」→ 联想 fruit/apple 各 4 个），顺序追加。
  const secondaryResults = await Promise.all(
    s.map(async (q) => {
      try {
        return (await searchIcons(q, 4)).icons.slice(0, 4);
      } catch {
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  const merged: string[] = [];
  const mergeRoundRobin = (results: { icons: string[] }[]) => {
    const maxLen = Math.max(...results.map((r) => r.icons.length));
    for (let i = 0; i < maxLen; i++) {
      for (const r of results) {
        const name = r.icons[i];
        if (name && !seen.has(name)) {
          seen.add(name);
          merged.push(name);
        }
      }
    }
  };
  mergeRoundRobin(primaryResults);
  mergeRoundRobin(fuzzyResults);
  for (const icons of secondaryResults) {
    for (const name of icons) {
      if (!seen.has(name)) {
        seen.add(name);
        merged.push(name);
      }
    }
  }
  const icons = merged.slice(0, MAX_MERGE);
  return { icons, total: icons.length };
}
