#!/usr/bin/env node
// 任务3主脚本：合并 map-part*.json → 对每个中文词取其候选英文段中
// 第一个在白名单（exact/prefix/suffix）真实存在的段 → 并入 zh-dict.json。
// 全部候选都不存在 → 跳过并记录到 skipped-list.txt。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DICT_PATH = join(ROOT, "public", "zh-dict.json");
const WHITELIST_PATH = join(__dirname, "seg-whitelist.json");

const dict = JSON.parse(readFileSync(DICT_PATH, "utf8"));
const whitelist = JSON.parse(readFileSync(WHITELIST_PATH, "utf8"));
const whiteSet = new Set(Object.keys(whitelist));

// 段存在性缓存
const segCache = new Map();
function segExists(seg) {
  if (segCache.has(seg)) return segCache.get(seg);
  let hit = false;
  if (whiteSet.has(seg)) hit = true;
  else {
    for (const s of whiteSet) {
      if (s.startsWith(seg) || s.endsWith(seg)) { hit = true; break; }
    }
  }
  segCache.set(seg, hit);
  return hit;
}

// 中文词覆盖检查
const zhIndex = new Set();
for (const e of dict) for (const zh of e.zh) zhIndex.add(zh.trim());
function covered(q) {
  for (const zh of zhIndex) {
    if (zh === q) return true;
    if (zh.length >= 2 && q.includes(zh)) return true;
    if (q.length >= 2 && zh.includes(q)) return true;
  }
  return false;
}

// 合并所有映射分片
const files = readdirSync(__dirname)
  .filter((f) => /^map-part\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const MAP = new Map();
for (const f of files) {
  const part = JSON.parse(readFileSync(join(__dirname, f), "utf8"));
  for (const [zh, ens] of Object.entries(part)) {
    if (MAP.has(zh)) MAP.set(zh, [...MAP.get(zh), ...ens]);
    else MAP.set(zh, ens);
  }
}
console.log(`合并映射 ${files.length} 个分片，共 ${MAP.size} 个中文词`);

// 按 zh 词条索引（含已有词条）
const byZh = new Map();
for (const e of dict) for (const zh of e.zh) {
  if (!byZh.has(zh)) byZh.set(zh, e);
}

let added = 0, merged = 0, skipped = 0;
const skippedList = [];

for (const [zh, cands] of MAP) {
  if (covered(zh)) { continue; } // 已覆盖
  const hit = cands.find((c) => segExists(c));
  if (!hit) { skipped++; skippedList.push(zh); continue; }
  const entry = byZh.get(zh);
  if (entry) {
    if (!entry.en.includes(hit)) entry.en.push(hit);
    merged++;
  } else {
    dict.push({ en: [hit], zh: [zh] });
    byZh.set(zh, dict[dict.length - 1]);
    added++;
  }
}

// 整体重写保持单行风格
const body = dict.map((e) => `  ${JSON.stringify(e)}`).join(",\n");
writeFileSync(DICT_PATH, `[\n${body}\n]\n`);
JSON.parse(readFileSync(DICT_PATH, "utf8"));

writeFileSync(join(__dirname, "skipped-list.txt"), `# 中文词在白名单中无对应英文段（库中不存在对应图标），未入库\n${skippedList.join("\n")}\n`);

console.log(`完成：新增 ${added} 词条，并入 ${merged}，跳过 ${skipped}（库中无对应英文）`);
console.log(`zh-dict.json 现共 ${dict.length} 词条`);
console.log(`跳过清单 → scripts/skipped-list.txt`);
