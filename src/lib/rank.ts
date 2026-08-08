// 搜索结果相关度重排：按图标名与检索词的字面匹配层级做稳定排序。
// 不改变集合成员，只改顺序；0 分图标（API alias/keyword 召回）沉底且保持原序。
//
// 设计目标：搜「相机」→ camera 精确匹配 > camera-fill(去variant) > camera-off(前缀)
//            > video-camera(独立段) > videocamera(纯子串)，层级严格不可穿越。
// terms 顺序 = 相关度顺序（zhSearch 已按专一度排好），靠前的小幅加分。

import { STYLE_TOKENS, isSize } from "./variants";

interface PreparedTerm {
  segs: string[];
  joined: string;
  bonus: number;
}

const TIER_EXACT = 4000; // name === term（lucide:camera）
const TIER_CORE_EXACT = 3500; // 去掉尾部 variant 段后 === term（camera-fill）
const TIER_PREFIX = 3000; // core 段序列以 term 段序列开头且还有剩余（camera-off）
const TIER_SEGMENT = 2000; // term 段序列作为独立连续段出现（video-camera）
const TIER_SUBSTR = 1000; // name.includes(term) 纯子串（videocamera）
// 最小层差 500 ≫ 最大位置加分（terms.length ≤ 24），低档加任何 bonus 都无法越档。

function nameOf(full: string): string {
  const i = full.indexOf(":");
  return i === -1 ? full : full.slice(i + 1);
}

// 归一化 term：trim / 小写 / 空格·下划线 → "-"，便于按段比较。
function prepareTerm(raw: string, index: number, total: number): PreparedTerm | null {
  const norm = raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  if (!norm) return null;
  return { segs: norm.split("-"), joined: norm, bonus: total - index };
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

function scoreTerm(full: string, t: PreparedTerm): number {
  const name = nameOf(full).toLowerCase();
  const segs = name.split("-");
  const core = coreSegments(segs);
  const coreJoined = core.join("-");

  if (name === t.joined) return TIER_EXACT + t.bonus;
  if (coreJoined === t.joined) return TIER_CORE_EXACT + t.bonus;
  // core 以 term 段开头且还有剩余段（camera-off；单段 term 时即前缀语义）
  if (t.segs.length < core.length && core.slice(0, t.segs.length).join("-") === t.joined) {
    return TIER_PREFIX + t.bonus;
  }
  if (containsSegments(segs, t.segs)) return TIER_SEGMENT + t.bonus;
  if (name.includes(t.joined)) return TIER_SUBSTR + t.bonus;
  return 0;
}

/** 稳定重排。terms 为空或 icons 为空时返回原序副本。 */
export function rankIconsByRelevance(icons: string[], terms: string[]): string[] {
  if (icons.length === 0 || terms.length === 0) return icons.slice();
  const prepared = terms
    .map((t, i) => prepareTerm(t, i, terms.length))
    .filter(Boolean) as PreparedTerm[];
  if (prepared.length === 0) return icons.slice();

  const scored = icons.map((ic) => {
    let best = 0;
    for (const t of prepared) {
      const s = scoreTerm(ic, t);
      if (s > best) best = s;
    }
    return { ic, s: best };
  });

  // ES2019+ Array.sort 稳定：同分保持输入序（= 原 API / round-robin 序）。
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.ic);
}
