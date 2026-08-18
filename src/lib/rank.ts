// 搜索结果相关度重排：把最相关的结果排到最前面。
// 不改变集合成员，只改顺序；0 分图标（API alias/keyword 召回）沉底且保持原序。
//
// 设计目标（按优先级）：
//  1. 组合关键词（用户输入 ≥2 个空格分隔的关键词，如 "首页 wifi" / "arrow left"）：
//     先比关键词覆盖数——同时命中两个关键词的图标（home-wifi）排在最前，
//     即使它只是前缀/段级匹配；只命中单个关键词的"完美精确"（home 或 wifi）次之。
//  2. 单关键词：严格层级 精确(相机) > 去variant精确(camera-fill) > 前缀(camera-off)
//     > 独立段(video-camera) > 子串(videocamera) > 单词碎片(arrowup 含 arrow)。
//     层级之间严格不可穿越。
//  3. 同层内：主词关键词（输入靠前）优先 > 命中总分 > 集合偏好 > 名字更短 > 原序。
//
// 集合偏好：lucide/ri/tabler 等一线 UI 集排在 material-symbols 这类巨型但名字
// 冗长的集合前面，打破 Iconify API 默认顺序（material-symbols 习惯性霸榜）对
// UI 设计师搜索体验的干扰。

import { STYLE_TOKENS, isSize } from "./variants";

// 层级常量（越大越相关）
const TIER_EXACT = 8; // name === term（lucide:camera）
const TIER_CORE_EXACT = 7; // 去掉尾部 variant 段后 === term（camera-fill）
const TIER_PREFIX = 6; // core 段序列以 term 段序列开头且还有剩余（camera-off）
const TIER_SEGMENT = 5; // term 段序列作为独立连续段出现（video-camera）
const TIER_SUBSTR = 4; // name.includes(term) 纯子串（videocamera）
const TIER_WORD_SEG = 3; // 单词作为独立段出现（arrow-left 的 "left"）
const TIER_WORD_PREFIX = 2; // 名字以 单词- 开头
const TIER_WORD_SUBSTR = 1; // 名字包含单词（arrowup 匹配 "arrow"）

// 排序用的层级权重（每层差 1e9，严格区分）
const TIER_WEIGHT = (t: number) => t * 1_000_000_000;
// 关键词覆盖阈值：只有词组级命中（真包含该关键词的语义）才算"覆盖"一个关键词。
// 单词碎片命中（arrow-up 里含 "arrow" 片段）不算覆盖——否则 arrow-up 会靠
// 共享的 "arrow" 冒充同时覆盖"箭头 向下"两个关键词。
const COVER_MIN_TIER = TIER_SUBSTR;

/** 一个关键词 token：terms 按主词→联想→fuzzy 的顺序排好。 */
export interface RankGroup {
  /** 该关键词的全部检索词（已小写、去空） */
  terms: string[];
}

// 集合偏好表：前排一线 UI 集 → 越靠前加成越高；未收录的集合 0 加成。
const SET_RANK = [
  // 一线简洁线性 UI 集
  "lucide", "ri", "tabler", "heroicons", "heroicons-outline", "heroicons-solid",
  "mdi-light", "ph", "mingcute", "mdi", "ic", "ant-design", "ep",
  "bx", "bxs", "gravity-ui", "circum", "akar-icons", "zondicons", "prime",
  // 中量级 UI 集
  "fluent", "material-symbols", "solar", "hugeicons", "icon-park", "icon-park-outline",
  "majesticons", "quill", "oui", "iconamoon", "solaris",
  // 开发/品牌类
  "codicon", "vscode-icons", "simple-icons", "devicon", "logos", "bxl", "fa6-brands",
  // 厚重/彩色/特殊风格放最后
  "fa6-solid", "fa-solid", "game-icons", "flat-color-icons", "noto", "twemoji", "openmoji",
];
const SET_MAX_BONUS = 50_000; // 远小于 1e9 层差，绝不越层

function setBonus(prefix: string): number {
  const i = SET_RANK.indexOf(prefix);
  if (i === -1) return 0;
  return Math.round(((SET_RANK.length - i) / SET_RANK.length) * SET_MAX_BONUS);
}

interface PreparedTerm {
  segs: string[];
  joined: string;
  words: string[];
}

// 归一化 term：trim / 小写 / 空格·下划线 → "-"，便于按段比较。
function prepareTerm(raw: string): PreparedTerm | null {
  const norm = raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  if (!norm) return null;
  return { segs: norm.split("-"), joined: norm, words: [...new Set(norm.split("-"))] };
}

function nameOf(full: string): string {
  const i = full.indexOf(":");
  return i === -1 ? full : full.slice(i + 1);
}

// 从尾部连续剥离 style/size 段得到 core（至少保留 1 段）。
// 只影响 T3.5/T3 两档；T2/T1 仍用原始段判断，不会漏匹配。
function coreSegments(segs: string[]): string[] {
  let end = segs.length;
  while (end > 1 && (STYLE_TOKENS.has(segs[end - 1]) || isSize(segs[end - 1]))) {
    end--;
  }
  return segs.slice(0, end);
}

// term 段序列是否在 name 段序列中作为连续子序列出现。
function containsSegments(nameSegs: string[], termSegs: string[]): boolean {
  if (termSegs.length === 0 || termSegs.length > nameSegs.length) return false;
  outer: for (let i = 0; i <= nameSegs.length - termSegs.length; i++) {
    for (let j = 0; j < termSegs.length; j++) {
      if (nameSegs[i + j] !== termSegs[j]) continue outer;
    }
    return true;
  }
  return false;
}

// 单词级兜底：词组整体未命中时，看单个单词是否出现在名字里。
function wordScore(segs: string[], name: string, w: string): number {
  if (segs.includes(w)) return TIER_WORD_SEG; // arrow-left 的 "left"
  if (name.startsWith(w + "-")) return TIER_WORD_PREFIX; // arrow-home 的 "arrow"
  if (name.includes(w)) return TIER_WORD_SUBSTR; // arrowup 的 "arrow"
  return 0;
}

function scoreTerm(
  name: string,
  segs: string[],
  core: string[],
  coreJoined: string,
  t: PreparedTerm,
): number {
  if (name === t.joined) return TIER_EXACT;
  if (coreJoined === t.joined) return TIER_CORE_EXACT;
  if (t.segs.length < core.length && core.slice(0, t.segs.length).join("-") === t.joined) {
    return TIER_PREFIX;
  }
  if (containsSegments(segs, t.segs)) return TIER_SEGMENT;
  if (name.includes(t.joined)) return TIER_SUBSTR;
  // 词组未整体命中 → 单词级兜底
  let ws = 0;
  for (const w of t.words) {
    const s = wordScore(segs, name, w);
    if (s > ws) ws = s;
  }
  return ws;
}

interface ScoredIcon {
  ic: string;
  a: number; // 主导因子：组合关键词=覆盖数;单关键词=最高层级权重
  b: number; // 次要因子：同上反选
  c: number; // 主词优先（靠前关键词先命中者胜）＝ -firstMatchedGroupIndex
  d: number; // 命中总分（覆盖各关键词的层级之和）
  e: number; // 集合偏好加成
  f: number; // -名字长度（越短越"专一"）
}

/**
 * 稳定重排。groups 为空或 icons 为空时返回原序副本。
 * @param multiKeyword 查询含多个空格分隔的关键词，打开"覆盖优先"排序。
 */
export function rankIconsByRelevance(
  icons: string[],
  groups: RankGroup[],
  opts?: { multiKeyword?: boolean },
): string[] {
  if (icons.length === 0 || groups.length === 0) return icons.slice();

  const prepared = groups.map((g) => ({
    terms: g.terms.map(prepareTerm).filter((x): x is PreparedTerm => x !== null),
  }));
  const multi = opts?.multiKeyword ?? false;

  const scored = icons.map((ic): ScoredIcon => {
    const prefix = ic.slice(0, ic.indexOf(":"));
    const name = nameOf(ic).toLowerCase();
    const segs = name.split("-");
    const core = coreSegments(segs);
    const coreJoined = core.join("-");

    let cover = 0;
    let bestTier = 0;
    let firstMatch = -1;
    let totalTier = 0;

    let bestTermIdx = Number.MAX_SAFE_INTEGER; // 命中最高层级的检索词的最前位置（单关键词用）
    let flatIdx = 0;
    for (let gi = 0; gi < prepared.length; gi++) {
      let gTier = 0;
      for (const t of prepared[gi].terms) {
        const s = scoreTerm(name, segs, core, coreJoined, t);
        // 命中总分子:每个命中的检索词都累计(而非只取组内最大值),
        // 像 arrow-down 对"箭头 向下"同时命中 arrow/down 两个方向词,
        // 总分明显高于只靠单词碎片命中的 down——保证双向强相关图标排最前。
        if (s > 0) totalTier += s;
        if (s > gTier) gTier = s;
        // 最高层级命中位置：单关键词时让主词（如 首页→home，位置最前）
        // 压过 alias 词条（home-2/home-3），避免被高总分反超
        if (s > bestTier || (s === bestTier && s > 0 && flatIdx < bestTermIdx)) {
          if (s >= bestTier) { bestTier = s; bestTermIdx = flatIdx; }
        }
        flatIdx++;
      }
      if (gTier >= COVER_MIN_TIER) {
        cover++;
        if (firstMatch === -1) firstMatch = gi;
      }
    }

    return {
      ic,
      a: multi ? cover : TIER_WEIGHT(bestTier),
      b: multi ? TIER_WEIGHT(bestTier) : cover,
      // 单关键词：最高层级命中词条的位置越前越好（home 于 home-2 / house 之前）；
      // 组合关键词：最关键（输入靠前）的组先命中者胜
      c: multi ? (firstMatch === -1 ? Number.MAX_SAFE_INTEGER : firstMatch) : bestTermIdx,
      d: totalTier,
      e: setBonus(prefix),
      f: -name.length,
    };
  });

  // ES2019+ Array.sort 稳定：同分保持输入序（= 原 API / round-robin 序）。
  scored.sort(
    (x, y) =>
      y.a - x.a || y.b - x.b || x.c - y.c || y.d - x.d || y.e - x.e || y.f - x.f,
  );
  return scored.map((x) => x.ic);
}
