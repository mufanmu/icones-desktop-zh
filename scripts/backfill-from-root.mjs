#!/usr/bin/env node
// 任务2：从 zh-root.json 反向补齐。
// 对每个 [英文段 → 中文词] 映射：
//   1. 英文段必须命中白名单（真实存在于 Iconify 库）——子串匹配（库中可能是 xxx-shield 等组合）
//   2. 中文词未被词典覆盖 → 把该段并入对应中文词条（union）
// 这样保证「中文词 → 英文段」的关联里英文段都是库中真实存在的。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DICT_PATH = join(ROOT, "public", "zh-dict.json");
const ROOT_TABLE_PATH = join(ROOT, "scripts", "zh-root.json");
const WHITELIST_PATH = join(__dirname, "seg-whitelist.json");

const dict = JSON.parse(readFileSync(DICT_PATH, "utf8"));
const rootTable = JSON.parse(readFileSync(ROOT_TABLE_PATH, "utf8"));
const whitelist = JSON.parse(readFileSync(WHITELIST_PATH, "utf8"));
const whiteSet = new Set(Object.keys(whitelist));

// 英文段是否真实存在：直接命中，或作为某真实段的前缀/子串（如 shield → shield-check）
function segExists(seg) {
  if (whiteSet.has(seg)) return true;
  for (const s of whiteSet) {
    if (s.startsWith(seg) || s.endsWith(seg)) return true;
  }
  return false;
}

// 中文词是否已被词典覆盖（与搜索逻辑一致）
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

let added = 0, merged = 0, skippedNoSeg = 0, skippedCovered = 0;
const noSegWords = [];
const byZh = new Map();
for (const e of dict) for (const zh of e.zh) {
  if (!byZh.has(zh)) byZh.set(zh, e);
}

for (const [seg, zhs] of Object.entries(rootTable)) {
  if (!segExists(seg)) { skippedNoSeg += zhs.length; noSegWords.push(...zhs); continue; }
  for (const zh of zhs) {
    if (covered(zh)) { skippedCovered++; continue; }
    // 找已有该中文词的词条并入 en；否则新建
    const entry = byZh.get(zh);
    if (entry) {
      if (!entry.en.includes(seg)) entry.en.push(seg);
      merged++;
    } else {
      dict.push({ en: [seg], zh: [zh] });
      byZh.set(zh, dict[dict.length - 1]);
      added++;
    }
  }
}

// 整体重写保持单行风格
const body = dict.map((e) => `  ${JSON.stringify(e)}`).join(",\n");
writeFileSync(DICT_PATH, `[\n${body}\n]\n`);
JSON.parse(readFileSync(DICT_PATH, "utf8"));

console.log(`zh-root 反向补齐完成:`);
console.log(`  新增词条 ${added}，并入已有词条 ${merged}`);
console.log(`  跳过：库中无该英文段 ${skippedNoSeg}，已覆盖 ${skippedCovered}`);
console.log(`  zh-dict.json 现共 ${dict.length} 词条`);
