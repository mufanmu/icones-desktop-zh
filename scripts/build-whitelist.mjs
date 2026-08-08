#!/usr/bin/env node
// 拉取 Iconify top40 集合全部图标名 → 拆词段 → 统计真实存在的英文段(白名单)
// 输出 scripts/seg-whitelist.json: { 段: 频次 }
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = "https://api.iconify.design";
const CONCURRENCY = 12;
const TIMEOUT_MS = 20000;
const RETRIES = 3;
const MAX_PER_SET = 20000; // 全库取样上限（material-symbols 2万+ 也尽量全取）

const STYLE_TOKENS = new Set([
  "filled", "fill", "regular", "outline", "outlined", "bold", "solid",
  "line", "linear", "broken", "duotone", "twotone", "sharp", "round",
  "rounded", "thin", "light", "extralight", "medium", "semibold", "black",
  "mono", "color", "colored", "flat", "gradient", "stroke", "curved",
]);
const isSize = (t) => /^\d{2,3}$/.test(t) && +t >= 8 && +t <= 512;
const SIZE_SUFFIX = new Set(["1x1", "4x3"]);

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
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error("unreachable");
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
  // 全库白名单：搜索会命中所有 Iconify 集合，故拉取全部集合（不限于 top40）
  const entries = Object.entries(collections)
    .map(([prefix, meta]) => ({ prefix, total: meta.total ?? 0 }))
    .filter((e) => e.total >= 5) // 过滤空壳/测试库
    .sort((a, b) => b.total - a.total);
  console.log(`   选取 ${entries.length} 个集合（全库，含 emoji 等人物/表情库）`);

  console.log("2) 拉取图标名…");
  const segCount = new Map();
  const results = new Array(entries.length);
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < entries.length) {
      const i = idx++;
      const e = entries[i];
      try {
        const data = await fetchJson(`${API}/collection?prefix=${e.prefix}`);
        const names = new Set();
        if (Array.isArray(data.uncategorized)) data.uncategorized.forEach((n) => names.add(n));
        if (data.categories) Object.values(data.categories).forEach((arr) => arr.forEach((n) => names.add(n)));
        if (data.aliases) Object.keys(data.aliases).forEach((n) => names.add(n));
        results[i] = [...names].slice(0, MAX_PER_SET);
      } catch (err) {
        console.error(`  [skip] ${e.prefix}: ${err.message}`);
        results[i] = [];
      }
    }
  });
  await Promise.all(workers);

  for (const list of results) {
    for (const n of list) {
      for (const s of new Set(cleanSegments(n))) {
        segCount.set(s, (segCount.get(s) ?? 0) + 1);
      }
    }
  }

  const sorted = [...segCount.entries()].sort((a, b) => b[1] - a[1]);
  const out = Object.fromEntries(sorted);
  writeFileSync(join(__dirname, "seg-whitelist.json"), JSON.stringify(out, null, 1));
  console.log(`   共 ${sorted.length} 个真实英文段 → scripts/seg-whitelist.json`);
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
