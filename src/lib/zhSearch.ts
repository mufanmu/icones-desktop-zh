// 中文模糊搜索支持：检测中文输入并在本地词典中翻译成英文检索词，
// 命中后对 Iconify 全文搜索 API 发起多关键词联合查找（并集去重）。

export interface DictEntry {
  en: string[];
  zh: string[];
  _cn?: boolean; // 标记中国相关词条（含台港澳）：互搜"中国"时一并展开
}

let dictCache: DictEntry[] | null = null;
let zhIndex: Map<string, string[]> | null = null; // zh term -> en terms
let cnTermsCache: string[] | null = null; // 中国相关全部英文码集合

const CJK = /[\u4e00-\u9fff]/;
const FLAG_PREFIXES = new Set(["cif", "circle-flags", "flag", "flagpack"]);
const FLAG_SIZE_SUFFIX = new Set(["1x1", "4x3"]); // flag 库的尺寸后缀白名单

export function isChinese(q: string): boolean {
  return CJK.test(q);
}

export async function loadDict(): Promise<DictEntry[]> {
  if (dictCache) return dictCache;
  try {
    const url = `${import.meta.env.BASE_URL}zh-dict.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`dict http ${res.status}`);
    const data = (await res.json()) as DictEntry[];
    zhIndex = new Map<string, string[]>();
    cnTermsCache = [];
    for (const e of data) {
      for (const zh of e.zh) {
        const norm = zh.trim();
        if (!norm) continue;
        const prev = zhIndex.get(norm);
        zhIndex.set(norm, prev ? [...prev, ...e.en] : [...e.en]);
      }
      if (e._cn) cnTermsCache.push(...e.en);
    }
    dictCache = data;
    return data;
  } catch (err) {
    console.error("[zh-dict] load failed:", err);
    dictCache = [];
    zhIndex = new Map();
    cnTermsCache = [];
    return [];
  }
}

// 把任意中文查询翻译成一组英文检索词，并附加按子串匹配的字典翻译。
// 中国相关词条（含台港澳）任一命中时，统一展开全部 cn/tw/hk/mo 英文码。
export function translateChinese(query: string): string[] {
  const q = query.trim();
  if (!q || !zhIndex) return [];
  const out = new Set<string>();
  let hitCn = false;

  const addEns = (ens: string[]) => {
    for (const en of ens) out.add(en);
  };

  // 1) 完整匹配
  for (const [zh, ens] of zhIndex!.entries()) {
    if (zh === q) {
      addEns(ens);
      // 完整匹配"中国"/"台湾"/"香港"/"澳门"任一 → 整组台港澳码一并加入
      const entry = dictCache!.find((e) => e.zh.includes(zh));
      if (entry?._cn) hitCn = true;
    }
  }

  // 2) 子串匹配（支持"我想找个搜索图标"这种长句）
  for (const [zh, ens] of zhIndex!.entries()) {
    if (zh.length < 2) continue;
    if (q.includes(zh)) {
      addEns(ens);
      const entry = dictCache!.find((e) => e.zh.includes(zh));
      if (entry?._cn) hitCn = true;
    }
  }

  // 3) 最长中文连续片段再尝试一次整体匹配（"搜索图标" -> "搜索"）
  if (out.size === 0) {
    const m = q.match(/[\u4e00-\u9fff]+/g) ?? [];
    for (const frag of m) {
      for (const [zh, ens] of zhIndex!.entries()) {
        if (zh === frag || (zh.length >= 2 && frag.includes(zh))) {
          addEns(ens);
          const entry = dictCache!.find((e) => e.zh.includes(zh));
          if (entry?._cn) hitCn = true;
        }
      }
    }
  }

  // 台港澳归类：命中任一中国相关词条 → 一并加入全部码
  if (hitCn && cnTermsCache) for (const en of cnTermsCache) out.add(en);

  return [...out];
}

// 国旗精确匹配过滤：对短 IoT国家码（<=3 字母纯码）的结果保留
// 仅"图标名 === 码" 或已知国旗库的标准后缀形态；剔除伪装者。
// 例如 gb 命中 circle-flags:gb / flag:gb-1x1 / flag:gb-4x3 / cif:gb / flagpack:gb
// 不命中 circle-flags:gb-eng / flag:gb-sct-1x1 / token:gbex
export function isCountryCode(term: string): boolean {
  return /^[a-z]{1,3}$/.test(term);
}

export function filterCountryIcons(icons: string[], term: string): string[] {
  const iso = term.toLowerCase();
  return icons.filter((full) => {
    const [prefix, name] = full.split(":");
    if (!name) return false;
    const lower = name.toLowerCase();
    const head = lower.split("-")[0];
    if (head !== iso) return false;
    // 短码严格等
    if (lower === iso) return FLAG_PREFIXES.has(prefix);
    // flag 库带尺寸后缀：iso-1x1 / iso-4x3
    if (prefix === "flag") {
      const parts = lower.split("-"); // [iso, suffix]
      return parts.length === 2 && FLAG_SIZE_SUFFIX.has(parts[1]);
    }
    // 其它国旗库不允许额外 dash 子码（gb-eng/gb-sct 等）
    return false;
  });
}

// 对一组翻译词，判断是否需要启用国旗精确模式：
// 任意一个是短国家码即启用，并对每个短码调用 filterCountryIcons 合并。
export function filterCountryIconsForTerms(icons: string[], terms: string[]): string[] {
  const codes = terms.filter(isCountryCode);
  if (codes.length === 0) return icons;
  const keep = new Set<string>();
  for (const code of codes) {
    for (const ic of filterCountryIcons(icons, code)) keep.add(ic);
  }
  return [...keep];
}