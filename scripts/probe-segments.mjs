#!/usr/bin/env node
// 探查 Iconify 图标名中与生活化大类相关的英文词段，供扩充词根表使用
// 用法: node scripts/probe-segments.mjs [minCount]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = "https://api.iconify.design";
const MIN_COUNT = Number(process.argv[2] ?? 3);

// 与目标大类相关的英文词段关键词（用于筛选候选）
const CATEGORY_KEYWORDS = new Set([
  // 人物/美女
  "woman", "women", "girl", "girls", "man", "men", "people", "person", "human",
  "beauty", "beautiful", "pretty", "attractive", "model", "fashion", "style",
  "bride", "groom", "wedding", "princess", "queen", "king", "lady", "gentleman",
  "female", "male", "adult", "teenager", "baby", "child", "boy", "kid",
  // 发型
  "hair", "hairstyle", "haircut", "beard", "moustache", "mustache", "ponytail",
  "bun", "braid", "curly", "bald", "wig", "comb", "barber", "shave", "razor",
  "scissors", "facial", "sideburns", "dreadlocks", "blonde", "brunette", "afro",
  // 美容/化妆
  "makeup", "lipstick", "nail", "manicure", "pedicure", "eyebrow", "eyelash",
  "mascara", "blush", "foundation", "cosmetic", "cosmetics", "perfume", "spa",
  "massage", "mirror", "brush", "cream", "lotion", "towel", "bath", "shower",
  "soap", "shampoo", "lips", "face", "facial", "skincare", "wrinkle", "mask",
  // 服饰
  "dress", "shirt", "tshirt", "t-shirt", "pants", "trousers", "skirt", "hat",
  "cap", "coat", "jacket", "sweater", "hoodie", "shoes", "boots", "sneakers",
  "socks", "gloves", "scarf", "tie", "belt", "bag", "purse", "handbag", "wallet",
  "sunglasses", "glasses", "watch", "necklace", "ring", "earring", "jewelry",
  "crown", "clothes", "clothing", "wear", "wearing", "uniform", "apron", "vest",
  "kimono", "suit", "jeans", "shorts", "swimsuit", "bikini", "pajamas", "slippers",
  "umbrella", "button", "zipper", "pocket", "collar", "sleeve", "turban", "hijab",
  // 动物
  "cat", "dog", "bird", "fish", "horse", "cow", "pig", "sheep", "goat", "chicken",
  "duck", "goose", "rabbit", "mouse", "rat", "lion", "tiger", "bear", "wolf",
  "fox", "elephant", "giraffe", "zebra", "monkey", "panda", "koala", "kangaroo",
  "penguin", "owl", "eagle", "hawk", "parrot", "spider", "bee", "butterfly",
  "ant", "snake", "frog", "turtle", "shark", "whale", "dolphin", "crab", "lobster",
  "shrimp", "snail", "bug", "insect", "hamster", "hedgehog", "squirrel", "deer",
  "camel", "donkey", "mule", "buffalo", "paw", "wing", "tail", "horn", "fur",
  "feather", "claw", "beak", "hoof", "bunny", "dragon", "dinosaur", "unicorn",
  "puppy", "kitten", "chick", "goat", "turkey", "rooster", "peacock",
  // 食物
  "food", "fruit", "apple", "banana", "orange", "grape", "strawberry", "watermelon",
  "cherry", "peach", "lemon", "pineapple", "mango", "pear", "kiwi", "coconut",
  "vegetable", "tomato", "potato", "carrot", "onion", "garlic", "pepper", "corn",
  "cabbage", "broccoli", "cucumber", "pumpkin", "mushroom", "eggplant", "salad",
  "bread", "cake", "cookie", "candy", "chocolate", "icecream", "ice-cream", "donut",
  "pizza", "hamburger", "burger", "fries", "noodle", "noodles", "rice", "sushi",
  "ramen", "sandwich", "taco", "steak", "chicken", "egg", "cheese", "butter",
  "milk", "coffee", "tea", "juice", "water", "beer", "wine", "soda", "cola",
  "breakfast", "lunch", "dinner", "dessert", "snack", "meal", "restaurant",
  "cook", "cooking", "chef", "kitchen", "pan", "pot", "bowl", "plate", "cup",
  "fork", "spoon", "knife", "chopsticks", "grill", "bbq", "barbecue",
  // 表情/情绪
  "smile", "smiley", "laugh", "cry", "crying", "angry", "sad", "happy", "joy",
  "wink", "kiss", "surprise", "surprised", "scared", "afraid", "fear", "love",
  "heart", "like", "dislike", "hate", "shock", "shocked", "confused", "embarrassed",
  "proud", "worried", "tired", "sleepy", "sick", "cool", "nerd", "cheeky",
  "grin", "grimace", "frown", "frowning", "blush", "flushed", "expression",
  "emotion", "feel", "feeling", "mood", "face", "faces", "emoji",
  // 动作/身体
  "hand", "hands", "finger", "fingers", "arm", "arms", "leg", "legs", "foot",
  "feet", "eye", "eyes", "ear", "ears", "nose", "mouth", "tooth", "teeth",
  "tongue", "brain", "heart", "lung", "bone", "muscle", "wrist", "knee", "elbow",
  "shoulder", "neck", "head", "hair", "thumb", "fist", "palm", "point", "pointing",
  "wave", "waving", "clap", "clapping", "dance", "dancing", "run", "running",
  "walk", "walking", "jump", "jumping", "sit", "sitting", "stand", "standing",
  "sleep", "sleeping", "swim", "swimming", "workout", "exercise", "yoga",
  "meditation", "pray", "praying", "salute", "saluting", "hug", "hugging",
  "wrestling", "biking", "cycling", "skate", "skating", "surf", "surfing",
  "kayak", "rowing", "climbing", "hiking", "golf", "tennis", "soccer", "football",
  "basketball", "baseball", "volleyball", "badminton", "table-tennis", "ping",
  "bowling", "boxing", "karate", "fencing", "ski", "skating", "snowboard",
]);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("http " + res.status);
  return await res.json();
}

async function main() {
  console.log("1) 拉取集合列表…");
  const cols = await fetchJson(`${API}/collections`);
  const entries = Object.entries(cols)
    .map(([p, m]) => ({ p, total: m.total ?? 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 40);
  console.log("   选取:", entries.map((e) => e.p).join(" "));

  console.log("2) 拉取图标名（并发 8）…");
  const results = [];
  const pool = [...entries];
  const workers = Array.from({ length: 8 }, async () => {
    while (pool.length) {
      const e = pool.pop();
      try {
        const data = await fetchJson(`${API}/collection?prefix=${e.p}`);
        const names = new Set();
        if (Array.isArray(data.uncategorized)) data.uncategorized.forEach((n) => names.add(n));
        if (data.categories) Object.values(data.categories).forEach((arr) => arr.forEach((n) => names.add(n)));
        if (data.aliases) Object.keys(data.aliases).forEach((n) => names.add(n));
        results.push([...names].slice(0, 4000));
      } catch (err) {
        console.error(`  [skip] ${e.p}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  console.log("3) 词段统计…");
  const segCount = new Map();
  for (const names of results) {
    for (const n of names) {
      const segs = n.split("-");
      const seen = new Set(segs.filter((s) => s.length > 1));
      for (const s of seen) segCount.set(s, (segCount.get(s) ?? 0) + 1);
    }
  }

  console.log("4) 筛选与目标大类相关的词段…");
  const hits = [...segCount.entries()]
    .filter(([seg, cnt]) => CATEGORY_KEYWORDS.has(seg) && cnt >= MIN_COUNT)
    .sort((a, b) => b[1] - a[1]);

  console.log(`   命中 ${hits.length} 个词段（minCount=${MIN_COUNT}）:`);
  for (const [seg, cnt] of hits) console.log(`${seg}\t${cnt}`);

  // 输出到文件备用
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    join(__dirname, "probe-result.txt"),
    hits.map(([s, c]) => `${s}\t${c}`).join("\n") + "\n",
  );
  console.log("   已写入 scripts/probe-result.txt");
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
