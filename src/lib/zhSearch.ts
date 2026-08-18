// 中文模糊搜索支持：检测中文输入并在本地词典中翻译成英文检索词，
// 命中后对 Iconify 全文搜索 API 发起多关键词联合查找（并集去重）。

export interface DictEntry {
  en: string[];
  zh: string[];
  _cn?: boolean; // 标记中国相关词条（含台港澳）：互搜"中国"时一并展开
}

// 词典词条保留边界：同一中文词可命中多个词条（专属词条 + 类目混合词条）。
// ens 独立保存，翻译时才能区分「主词」（专属，如 香蕉→[banana]）与「联想词」
// （类目，如 水果→15 个 en）——避免搜「香蕉」被类目词条平级带入 15 个水果
// 检索词、结果被水果大全淹没（v0.1.5 回归根因）。
interface ZhEntry {
  ens: string[];
  cn: boolean;
}

let dictCache: DictEntry[] | null = null;
let zhIndex: Map<string, ZhEntry[]> | null = null; // zh term -> 命中的词条列表
let cnTermsCache: string[] | null = null; // 中国相关全部英文码集合

const CJK = /[\u4e00-\u9fff]/;
// 供 App 层判断关键词是否纯 ASCII（决定走 AND 单次搜索还是并集搜索）
export { CJK };
const FLAG_PREFIXES = new Set(["cif", "circle-flags", "flag", "flagpack"]);
const FLAG_SIZE_SUFFIX = new Set(["1x1", "4x3"]); // flag 库的尺寸后缀白名单

// 模糊关联的规模控制：避免反向匹配把词条/检索词数量引爆（每个英文词都会触发一次 API 请求）
const MAX_FUZZY_ENTRIES = 14; // 非精确命中的词条上限（按相关度评分取前 N）
const MAX_TERMS = 24; // 最终翻译出的英文检索词上限
const MAX_SECONDARY_ENTRIES = 2; // exact 命中的类目混合词条最多取前 N 个（联想）
const MAX_SECONDARY_PER = 2; // 每个类目混合词条最多取前 N 个 en（联想）

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
    zhIndex = new Map<string, ZhEntry[]>();
    cnTermsCache = [];
    for (const e of data) {
      for (const zh of e.zh) {
        const norm = zh.trim();
        if (!norm) continue;
        const entry: ZhEntry = { ens: e.en, cn: !!e._cn };
        const prev = zhIndex.get(norm);
        zhIndex.set(norm, prev ? [...prev, entry] : [entry]);
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

// 匹配命中记录：score 用于在非精确命中过多时做关联度裁剪。
// 三级匹配（优先级从高到低）：
//   exact   完整匹配：查询词 === 词条
//   forward 正向子串：查询词包含词条（"我想找个搜索图标" → 命中「搜索」）
//   reverse 反向模糊：词条包含查询词（"箭头" → 命中「左箭头」「右上箭头」「双箭头」…）
// reverse 是关联性的关键：用户给出一个概念大类时，把所有包含该概念的具体词条都联想出来。
interface ZhHit {
  zh: string;
  ens: string[];
  score: number;
  cn: boolean;
}

// 翻译计划：
//   primary   = 主词（专属词条，搜索结果应占绝对多数，取全量）
//   secondary = 类目混合词条联想（如 搜香蕉→水果词条的 fruit/apple，限量）
//   fuzzy     = forward/reverse 模糊词条（「首页→home-2/home-3」「箭头→arrow-left」，
//               是常用词结果的主要来源，必须取全量，否则结果会被砍短）
export interface TranslationPlan {
  primary: string[];
  secondary: string[];
  fuzzy: string[];
}

export function translateChineseFull(query: string): TranslationPlan {
  const q = query.trim();
  const none: TranslationPlan = { primary: [], secondary: [], fuzzy: [] };
  if (!q || !zhIndex) return none;

  // 纯英文/数字查询（如 gpt、alipay、visa）：只做词条精确匹配，
  // 不做 forward/reverse 子串模糊——避免 "pay" 反向命中 "paypal"、"car" 命中 "card" 等污染。
  const pureAscii = !CJK.test(q);

  const exact: ZhHit[] = [];
  const forward: ZhHit[] = [];
  const reverse: ZhHit[] = [];

  const matchAgainst = (text: string, minReverseLen: number) => {
    for (const [zh, entries] of zhIndex!.entries()) {
      // 精确匹配：纯英文查询不区分大小写（"QQ" 命中词条 "qq"）
      if (zh === text || (pureAscii && zh.toLowerCase() === text.toLowerCase())) {
        for (const e of entries) exact.push({ zh, ens: e.ens, score: 100 + zh.length, cn: e.cn });
      } else if (!pureAscii && zh.length >= 2 && text.includes(zh)) {
        for (const e of entries) forward.push({ zh, ens: e.ens, score: 50 + zh.length * 2, cn: e.cn });
      } else if (!pureAscii && text.length >= minReverseLen && zh.includes(text) && zh !== text) {
        // 关联度 = 查询词在词条中的占比，占比越高越相关（"箭头"之于「左箭头」高于之于「向上箭头图标」）
        const ratio = text.length / zh.length;
        for (const e of entries) reverse.push({ zh, ens: e.ens, score: 10 + ratio * 30, cn: e.cn });
      }
    }
  };

  // 1) 对整个查询做三级匹配（纯英文只走精确匹配）
  matchAgainst(q, 1);

  // 2) 整句无精确/正向命中时，取最长的几个 CJK 片段重试
  //    （支持"我想要一个向右的箭头图标"这种长句；片段 ≥2 字才做反向模糊，避免单字噪音）
  if (!pureAscii && exact.length === 0 && forward.length === 0) {
    const frags = (q.match(/[\u4e00-\u9fff]+/g) ?? [])
      .filter((f) => f !== q)
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);
    for (const frag of frags) matchAgainst(frag, 2);
  }

  // 3) 非精确命中的词条可能很多（常见字如「机/车/图」会命中几十条），
  //    按关联度评分取前 N，防止检索词爆炸导致 API 请求数失控。
  //    去污染：若某个正向命中的短词条是某条精确匹配词条的子串（如「面包」⊂「面包屑」），
  //    说明精确词条已经完整表达了意图，跳过该短词条，避免带入无关语义（面包屑 ≠ 面包）。
  const exactTerms = exact.map((h) => h.zh);
  const fuzzy = [...forward, ...reverse]
    .filter((h) => !exactTerms.some((t) => t.includes(h.zh) && t !== h.zh))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FUZZY_ENTRIES);

  // 4) 分层：exact 命中中 ens 最短的词条组 = 主词（专属词条，如 香蕉→[banana]）；
  //    更长的词条 = 类目混合词条（如 水果→15 个 en），只取少量作联想。
  //    避免搜「香蕉」被类目词条平级带入 15 个水果检索词、结果被水果大全淹没。
  let primaryHits: ZhHit[] = [];
  let secondaryHits: ZhHit[] = [];
  if (exact.length > 0) {
    const minLen = Math.min(...exact.map((h) => h.ens.length));
    primaryHits = exact
      .filter((h) => h.ens.length === minLen)
      .sort((a, b) => a.ens.length - b.ens.length);
    secondaryHits = exact.filter((h) => h.ens.length > minLen);
  }

  // 5) 合并检索词：主词全部优先；类目混合词条限量（联想）；fuzzy 全量；总数封顶。
  const primary = new Set<string>();
  const secondary = new Set<string>();
  const fuzzyOut = new Set<string>();
  let hitCn = false;
  const total = () => primary.size + secondary.size + fuzzyOut.size;
  const add = (set: Set<string>, ens: string[], max: number | null) => {
    const list = max === null ? ens : ens.slice(0, max);
    for (const en of list) {
      if (total() >= MAX_TERMS) break;
      // 联想词与主词重复时跳过（如「苹果」的混合词条含 apple），避免无谓的 API 请求
      if (set === secondary && primary.has(en)) continue;
      set.add(en);
    }
  };
  for (const h of primaryHits) {
    if (h.cn) hitCn = true;
    add(primary, h.ens, null);
  }
  for (const h of secondaryHits.slice(0, MAX_SECONDARY_ENTRIES)) {
    if (h.cn) hitCn = true;
    add(secondary, h.ens, MAX_SECONDARY_PER);
  }
  for (const h of fuzzy) {
    if (h.cn) hitCn = true;
    add(fuzzyOut, h.ens, null);
  }

  // 台港澳归类：命中任一中国相关词条 → 全部码并入主词
  // （国旗搜索必须取全量，不能走联想限量，否则各国家码只出前几个旗帜）。
  if (hitCn && cnTermsCache) {
    for (const en of cnTermsCache) {
      if (total() >= MAX_TERMS) break;
      primary.add(en);
    }
  }

  return { primary: [...primary], secondary: [...secondary], fuzzy: [...fuzzyOut] };
}

// 兼容入口：全部检索词按相关度拼接（主词在前、联想词、fuzzy 在后）。
export function translateChinese(query: string): string[] {
  const { primary, secondary, fuzzy } = translateChineseFull(query);
  return [...primary, ...secondary, ...fuzzy];
}

// ---- 关键词组合（关键词+关键词）支持 ----
// 用户输入可能包含多个空格分隔的关键词："首页 wifi"、"arrow left"、"图标 放大镜"。
// 旧实现把整句丢给 translateChineseFull 一次翻译，混输的英文词（wifi）会在整句维度
// 被丢弃（CJK 存在时不做纯 Ascii 精确匹配），导致"中文+英文"组合搜索漏词。
// 这里按空格切分后逐 token 独立翻译：中文 token 走词典，英文 token 无词典命中时
// 以自身为检索词，保证每个关键词都被保留。

export interface QueryToken {
  token: string; // 原始 token
  plan: TranslationPlan; // 该 token 的翻译计划（纯英文无命中时 primary=[token]）
}

/** 把用户输入切成关键词 token，并逐 token 翻译。 */
export function planQuery(query: string): QueryToken[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const plan = translateChineseFull(token);
      if (plan.primary.length || plan.secondary.length || plan.fuzzy.length) {
        return { token, plan };
      }
      return { token, plan: { primary: [token], secondary: [], fuzzy: [] } };
    });
}

/** 合并多个 token 的计划为一份 primary/secondary/fuzzy（跨 token 去重，保序）。 */
export function mergePlans(groups: QueryToken[]): TranslationPlan {
  const out: TranslationPlan = { primary: [], secondary: [], fuzzy: [] };
  const seen = new Set<string>();
  const push = (arr: string[], v: string) => {
    const val = v.trim().toLowerCase();
    if (!val || seen.has(val)) return;
    seen.add(val);
    arr.push(val);
  };
  for (const g of groups) {
    g.plan.primary.forEach((t) => push(out.primary, t));
    g.plan.secondary.forEach((t) => push(out.secondary, t));
    g.plan.fuzzy.forEach((t) => push(out.fuzzy, t));
  }
  return out;
}

// ISO 3166-1 alpha-2 国家/地区码全集。国旗库（circle-flags/flag/cif/flagpack）均以两字母码命名，
// 故仅当检索词是真实国家码时才启用国旗精确模式——避免把 map/car/cat/key/sun/add 这类普通短词
// 误判成"国家码"从而把整页结果清空（原 /^[a-z]{1,3}$/ 会命中所有 ≤3 字母词，是严重 bug）。
const COUNTRY_CODES = new Set(
  ("ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz " +
    "ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr " +
    "ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp " +
    "ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt " +
    "mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw " +
    "sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug " +
    "um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw").split(" "),
);

// 国旗精确匹配过滤：只有真实国家码（见 COUNTRY_CODES）才进入国旗模式。
// 仅"图标名 === 码" 或已知国旗库的标准后缀形态；剔除伪装者。
// 例如 gb 命中 circle-flags:gb / flag:gb-1x1 / flag:gb-4x3 / cif:gb / flagpack:gb
// 不命中 circle-flags:gb-eng / flag:gb-sct-1x1 / token:gbex
export function isCountryCode(term: string): boolean {
  return COUNTRY_CODES.has(term);
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
  const nonCodes = terms.filter((t) => t && !isCountryCode(t));
  const keep = new Set<string>();
  // 国家码：仅保留严格国旗匹配（剔除 gbex / gb-eng 之类伪装者）
  for (const code of codes) {
    for (const ic of filterCountryIcons(icons, code)) keep.add(ic);
  }
  // 非国家码词：仍按普通子串匹配保留，避免混合翻译（如 汽车→[car, vehicle]）里
  // 某个词恰好是国家码时，把其余正常结果一并丢弃。
  if (nonCodes.length > 0) {
    for (const full of icons) {
      const name = full.split(":").pop()!.toLowerCase();
      if (nonCodes.some((t) => name.includes(t))) keep.add(full);
    }
  }
  return [...keep];
}