#!/usr/bin/env node
// 反推 Iconify 图标库生成中文词根库：
// 1. 拉取 top 40 集合的图标名 → 2. 拆词段统计高频段 → 3. 用 zh-root.json 词根表翻译
// 4. 合并进 public/zh-dict.json（union 语义，整体重写保持单行风格）→ 5. 输出 review-list

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DICT_PATH = join(ROOT, "public", "zh-dict.json");
const ROOT_TABLE_PATH = join(ROOT, "scripts", "zh-root.json");
const REVIEW_PATH = join(ROOT, "scripts", "review-list.txt");

const API = "https://api.iconify.design";
const TOP_SETS = 40; // 按 total 取前 N 个集合
const MAX_PER_SET = 3000; // 单库取样上限（防 material-symbols 2万+ 权重失衡）
const TOP_SEGMENTS = 300; // 统计的高频词段数量
const CONCURRENCY = 8;
const TIMEOUT_MS = 20000;
const RETRIES = 3;

// variants.ts 的 STYLE_TOKENS / isSize 内联副本（脚本独立运行，不依赖 TS）
const STYLE_TOKENS = new Set([
  "filled", "fill", "regular", "outline", "outlined", "bold", "solid",
  "line", "linear", "broken", "duotone", "twotone", "sharp", "round",
  "rounded", "thin", "light", "extralight", "medium", "semibold", "black",
  "mono", "color", "colored", "flat", "gradient", "stroke", "curved",
]);
const isSize = (t) => /^\d{2,3}$/.test(t) && +t >= 8 && +t <= 512;
const SIZE_SUFFIX = new Set(["1x1", "4x3"]); // flag 库尺寸后缀

async function fetchJson(url, retries = RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`http ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i)); // 退避
    }
  }
  throw new Error("unreachable");
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = null;
        console.error(`  [skip] ${items[i]}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function cleanSegments(iconName) {
  const segs = iconName.split("-");
  return segs.filter(
    (s) =>
      s.length > 1 &&
      !STYLE_TOKENS.has(s) &&
      !isSize(s) &&
      !SIZE_SUFFIX.has(s) &&
      !/^\d+$/.test(s),
  );
}

async function main() {
  console.log("1) 拉取集合列表…");
  const collections = await fetchJson(`${API}/collections`);
  const entries = Object.entries(collections)
    .map(([prefix, meta]) => ({ prefix, total: meta.total ?? 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_SETS);
  console.log(`   选取 top ${entries.length} 集合:`, entries.map((e) => `${e.prefix}(${e.total})`).join(" "));

  console.log("2) 拉取图标名（并发 8 + 超时 + 重试）…");
  const results = await mapConcurrent(entries, CONCURRENCY, async ({ prefix }) => {
    const data = await fetchJson(`${API}/collection?prefix=${prefix}`);
    const names = new Set();
    if (Array.isArray(data.uncategorized)) data.uncategorized.forEach((n) => names.add(n));
    if (data.categories) Object.values(data.categories).forEach((arr) => arr.forEach((n) => names.add(n)));
    if (data.aliases) Object.keys(data.aliases).forEach((n) => names.add(n));
    return [...names].slice(0, MAX_PER_SET);
  });

  console.log("3) 词段统计…");
  const segCount = new Map();
  for (const names of results) {
    if (!names) continue;
    for (const n of names) {
      // 每图标内去重，再跨集合计数
      const seen = new Set(cleanSegments(n));
      for (const s of seen) segCount.set(s, (segCount.get(s) ?? 0) + 1);
    }
  }
  const top = [...segCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_SEGMENTS);
  console.log(`   统计到 ${segCount.size} 个词段，取 top ${top.length}`);

  console.log("4) 读取词根表…");
  const rootTable = JSON.parse(readFileSync(ROOT_TABLE_PATH, "utf8"));
  const covered = top.filter(([seg]) => rootTable[seg]);
  const uncovered = top.filter(([seg]) => !rootTable[seg]);
  console.log(`   词根表 ${Object.keys(rootTable).length} 条，覆盖 ${covered.length} / ${top.length} 高频段`);

  console.log("5) 合并进 zh-dict.json…");
  const dict = JSON.parse(readFileSync(DICT_PATH, "utf8"));
  let added = 0;
  let merged = 0;

  for (const [seg] of covered) {
    const zhs = rootTable[seg];
    // union 语义：en 含 seg → 并 zh；zh 有交集 → 并 en；否则 append
    const byEn = dict.find((e) => e.en.includes(seg));
    const byZh = dict.find((e) => e.zh.some((z) => zhs.includes(z)));
    if (byEn) {
      for (const z of zhs) if (!byEn.zh.includes(z)) byEn.zh.push(z);
      merged++;
    } else if (byZh) {
      if (!byZh.en.includes(seg)) byZh.en.push(seg);
      merged++;
    } else {
      dict.push({ en: [seg], zh: zhs });
      added++;
    }
  }

  // 整体重写，保持单行数组风格（与现有文件一致）
  const body = dict.map((e) => `  ${JSON.stringify(e)}`).join(",\n");
  writeFileSync(DICT_PATH, `[\n${body}\n]\n`);
  // 自校验
  JSON.parse(readFileSync(DICT_PATH, "utf8"));
  console.log(`   新增 ${added} 条，合并 ${merged} 条，dict 现共 ${dict.length} 词条`);

  console.log("6) 输出 review 清单…");
  const reviewLines = uncovered.map(([seg, cnt]) => `${seg}\t${cnt}`).join("\n");
  writeFileSync(REVIEW_PATH, `# 高频词段中词根表未覆盖的段（人工补 scripts/zh-root.json 后重跑入库）\n# 格式: 词段\t出现次数\n${reviewLines}\n`);
  console.log(`   未覆盖 ${uncovered.length} 段 → scripts/review-list.txt`);
  console.log("完成 ✅");
}

main().catch((err) => {
  console.error("gen-dict 失败:", err);
  process.exit(1);
});
