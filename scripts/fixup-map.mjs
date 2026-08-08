#!/usr/bin/env node
// 修复 apply-map 后的残留问题：
// 1) 补充映射表遗漏的词（灯笼/火锅/扫地机器人/奶茶等）
// 2) 修正候选段：优先选用白名单中真实存在的语义等价段（如 丈夫→marriage 而非 husband）
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DICT_PATH = join(ROOT, "public", "zh-dict.json");
const WHITELIST_PATH = join(__dirname, "seg-whitelist.json");

const dict = JSON.parse(readFileSync(DICT_PATH, "utf8"));
const whitelist = JSON.parse(readFileSync(WHITELIST_PATH, "utf8"));
const whiteSet = new Set(Object.keys(whitelist));

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
const byZh = new Map();
for (const e of dict) for (const zh of e.zh) {
  if (!byZh.has(zh)) byZh.set(zh, e);
}

// 修复映射：词 → 候选段（已针对白名单核验过，优先真实段）
const FIX = {
  // 亲属（库中无 husband/wife/uncle 等抽象称谓，用语义等价真实段）
  "叔叔": ["man", "male"], "阿姨": ["woman", "female"],
  "爷爷": ["elderly", "grandpa", "old"], "奶奶": ["elderly", "grandma", "old"],
  "外公": ["elderly", "grandpa"], "外婆": ["elderly", "grandma"],
  "丈夫": ["marriage", "ring", "man"], "妻子": ["marriage", "ring", "woman"],
  "老公": ["marriage", "ring", "man"], "老婆": ["marriage", "ring", "woman"],
  "男朋友": ["couple", "love", "heart"], "女朋友": ["couple", "love", "heart"],
  "哥哥": ["brother", "boy"], "弟弟": ["brother", "boy"],
  "姐姐": ["sister", "girl"], "妹妹": ["sister", "girl"],
  "儿子": ["son", "child", "baby"], "女儿": ["daughter", "child", "baby"],
  "青少年": ["youth", "teenager", "young"], "少年": ["youth", "boy"],
  "流浪汉": ["person", "homeless", "poor"], "乞丐": ["person", "poor", "homeless"],
  "摄影师": ["camera", "photo", "photography"], "律师": ["justice", "legal", "scales"],
  "法官": ["justice", "legal", "gavel"], "记者": ["news", "reporter", "media"],
  "水手": ["anchor", "ship", "sailor"], "空姐": ["airplane", "flight", "stewardess"],
  "空少": ["airplane", "flight", "steward"], "收银员": ["cash", "cashier", "register"],
  "清洁工": ["broom", "clean", "worker"], "保姆": ["baby", "care", "nanny"],
  // 发型美容（库中无这些词，用近似真实段）
  "刘海": ["hair", "face", "fringe"], "齐刘海": ["hair", "face", "fringe"],
  "编发": ["hair", "braid", "plait"], "鬓角": ["hair", "beard", "face"],
  "遮瑕": ["makeup", "cover", "hide"], "防晒霜": ["sun", "protect", "cream"],
  "精华": ["drop", "essence", "beauty"], "磨砂膏": ["scrub", "body", "beauty"],
  "去角质": ["skin", "body", "clean"], "保湿": ["water", "drop", "moisture"],
  "美白": ["white", "bright", "beauty"], "抗皱": ["face", "skin", "wrinkle"],
  "祛痘": ["face", "skin", "clean"], "古龙水": ["perfume", "spray", "fragrance"],
  "汗蒸": ["sauna", "steam", "hot"], "足浴": ["foot", "water", "spa"],
  "推拿": ["massage", "spa", "hand"], "穿孔": ["earring", "ear", "ring"],
  // 服饰（库中无 pajamas/raincoat 等，用语义段）
  "羽绒服": ["coat", "jacket", "winter"], "吊带": ["dress", "top", "strap"],
  "睡衣": ["moon", "sleep", "night"], "雨衣": ["rain", "umbrella", "coat"],
  "旗袍": ["dress", "traditional", "chinese"], "汉服": ["dress", "traditional", "chinese"],
  "婚纱": ["dress", "wedding", "bride"], "燕尾服": ["suit", "bowtie", "tuxedo"],
  "打底裤": ["pants", "tight", "legging"], "紧身裤": ["pants", "tight", "legging"],
  "阔腿裤": ["pants", "wide", "trousers"], "喇叭裤": ["pants", "flare", "trousers"],
  "工装裤": ["pants", "cargo", "work"], "百褶裙": ["skirt", "pleat", "fold"],
  "A字裙": ["skirt", "dress", "letter"], "纱裙": ["skirt", "tulle", "dress"],
  "牛仔裙": ["skirt", "denim", "jeans"], "短裙": ["skirt", "mini", "short"],
  "长裙": ["skirt", "long", "dress"], "皮鞋": ["shoes", "leather", "dress"],
  "帆布鞋": ["shoes", "canvas", "sneaker"], "平底鞋": ["shoes", "flat", "ballet"],
  "马丁靴": ["boots", "leather", "shoe"], "雪地靴": ["boots", "snow", "winter"],
  "雨靴": ["boots", "rain", "rubber"], "布鞋": ["shoes", "cloth", "fabric"],
  "板鞋": ["sneakers", "shoes", "skate"], "乐福鞋": ["shoes", "loafer", "leather"],
  "丝袜": ["socks", "leg", "stocking"], "裤袜": ["socks", "tight", "leg"],
  "船袜": ["socks", "ankle", "short"], "鞋带": ["shoes", "lace", "tie"],
  "鞋垫": ["shoes", "insole", "pad"], "鞋跟": ["shoes", "heel", "bottom"],
  "贝雷帽": ["hat", "beret", "cap"], "草帽": ["hat", "straw", "summer"],
  "毛线帽": ["hat", "knit", "winter"], "耳钉": ["earring", "stud", "ear"],
  "吊坠": ["necklace", "pendant", "jewelry"], "手链": ["bracelet", "wrist", "jewelry"],
  "手镯": ["bracelet", "bangle", "wrist"], "胸针": ["brooch", "pin", "jewelry"],
  "发夹": ["hair", "clip", "pin"], "发卡": ["hair", "clip", "pin"],
  "发带": ["headband", "hair", "band"], "头饰": ["headband", "tiara", "hair"],
  "手环": ["bracelet", "wrist", "band"], "单肩包": ["bag", "shoulder", "crossbody"],
  "斜挎包": ["bag", "crossbody", "shoulder"], "卡包": ["card", "wallet", "holder"],
  "遮阳伞": ["umbrella", "sun", "parasol"], "棉布": ["cotton", "fabric", "cloth"],
  "丝绸": ["silk", "fabric", "cloth"], "皮革": ["leather", "skin", "fabric"],
  "毛绒": ["fur", "plush", "soft"], "牛仔布": ["denim", "fabric", "jeans"],
  "蕾丝": ["lace", "fabric", "trim"], "网纱": ["mesh", "net", "fabric"],
  "雪纺": ["fabric", "silk", "soft"], "羊毛": ["wool", "sheep", "fiber"],
  "羽绒": ["feather", "down", "duck"],
  // 动物细分（库中多为通用段）
  "柴犬": ["dog", "shiba", "puppy"], "哈士奇": ["dog", "husky", "puppy"],
  "金毛": ["dog", "golden", "retriever"], "柯基": ["dog", "corgi", "puppy"],
  "橘猫": ["cat", "orange", "kitten"], "布偶猫": ["cat", "ragdoll", "kitten"],
  "折耳猫": ["cat", "ear", "kitten"], "暹罗猫": ["cat", "siamese", "kitten"],
  "麻雀": ["bird", "sparrow", "small"], "燕子": ["bird", "swallow", "fly"],
  "喜鹊": ["bird", "magpie", "black"], "乌鸦": ["bird", "crow", "black"],
  "鸽子": ["bird", "dove", "pigeon"], "鸵鸟": ["bird", "ostrich", "tall"],
  "啄木鸟": ["bird", "woodpecker", "tree"], "天鹅": ["bird", "swan", "white"],
  "大雁": ["bird", "goose", "wild"], "海鸥": ["bird", "seagull", "sea"],
  "白鹭": ["bird", "heron", "white"], "仙鹤": ["bird", "crane", "japan"],
  "丹顶鹤": ["bird", "crane", "red"], "蜂鸟": ["bird", "hummingbird", "small"],
  "翠鸟": ["bird", "kingfisher", "blue"], "小鸭": ["duck", "duckling", "bird"],
  "大鹅": ["goose", "bird", "farm"], "鹌鹑": ["bird", "quail", "small"],
  "斑鸠": ["bird", "dove", "pigeon"], "布谷鸟": ["bird", "cuckoo", "clock"],
  "黄鹂": ["bird", "oriole", "yellow"], "画眉": ["bird", "thrush", "song"],
  "金鱼": ["fish", "goldfish", "pet"], "鲤鱼": ["fish", "carp", "koi"],
  "鲈鱼": ["fish", "bass", "sea"], "三文鱼": ["fish", "salmon", "sea"],
  "金枪鱼": ["fish", "tuna", "sea"], "鳗鱼": ["fish", "eel", "sea"],
  "鱿鱼": ["fish", "squid", "sea"], "乌贼": ["fish", "squid", "sea"],
  "墨鱼": ["fish", "squid", "ink"], "海马": ["fish", "seahorse", "sea"],
  "珊瑚": ["sea", "coral", "reef"], "贝壳": ["shell", "sea", "conch"],
  "海螺": ["shell", "sea", "conch"], "海星": ["sea", "starfish", "star"],
  "皮皮虾": ["shrimp", "sea", "mantis"], "蝌蚪": ["frog", "tadpole", "water"],
  "蟾蜍": ["frog", "toad", "amphibian"], "壁虎": ["lizard", "gecko", "reptile"],
  "变色龙": ["lizard", "chameleon", "reptile"], "蟒蛇": ["snake", "python", "boa"],
  "毒蛇": ["snake", "viper", "cobra"], "蚯蚓": ["worm", "earth", "soil"],
  "水蛭": ["worm", "leech", "water"], "蛞蝓": ["snail", "slug", "garden"],
  "扇贝": ["shell", "scallop", "sea"], "鲍鱼": ["shell", "abalone", "sea"],
  "海胆": ["sea", "urchin", "spike"], "海参": ["sea", "cucumber", "marine"],
  "翼龙": ["dinosaur", "pterodactyl", "wing"], "霸王龙": ["dinosaur", "t-rex", "rex"],
  "剑龙": ["dinosaur", "stegosaurus", "spike"], "雷龙": ["dinosaur", "brontosaurus", "long"],
  "始祖鸟": ["bird", "dinosaur", "ancient"],
  "蜻蜓": ["insect", "dragonfly", "fly"], "马蜂": ["wasp", "bee", "hornet"],
  "黄蜂": ["wasp", "bee", "hornet"], "蝎子": ["scorpion", "animal", "sting"],
  "蜈蚣": ["centipede", "insect", "bug"], "蟋蟀": ["cricket", "insect", "bug"],
  "蝈蝈": ["cricket", "insect", "bug"], "螳螂": ["mantis", "insect", "pray"],
  "瓢虫": ["ladybug", "beetle", "insect"], "甲虫": ["beetle", "bug", "insect"],
  "金龟子": ["beetle", "bug", "insect"], "天牛": ["beetle", "bug", "insect"],
  "萤火虫": ["firefly", "bug", "glow"], "苍蝇": ["fly", "bug", "insect"],
  "蟑螂": ["cockroach", "bug", "insect"], "跳蚤": ["flea", "bug", "jump"],
  "虱子": ["louse", "bug", "insect"], "蜱虫": ["tick", "bug", "insect"],
  "毛毛虫": ["caterpillar", "worm", "bug"], "蚕": ["silkworm", "worm", "silk"],
  "飞蛾": ["moth", "butterfly", "insect"], "蝉": ["cicada", "insect", "bug"],
  "知了": ["cicada", "insect", "bug"], "蚱蜢": ["grasshopper", "insect", "bug"],
  "凤凰": ["phoenix", "bird", "fire"], "麒麟": ["dragon", "qilin", "animal"],
  "九尾狐": ["fox", "tail", "animal"], "鲲鹏": ["bird", "fish", "myth"],
  "玄武": ["turtle", "snake", "myth"], "朱雀": ["phoenix", "bird", "myth"],
  "青龙": ["dragon", "green", "myth"], "白虎": ["tiger", "white", "myth"],
  "腾蛇": ["snake", "dragon", "myth"], "饕餮": ["monster", "myth", "beast"],
  "貔貅": ["dragon", "myth", "beast"], "锦鲤": ["fish", "koi", "carp"],
  "神鸟": ["bird", "phoenix", "myth"],
  "肉垫": ["paw", "cat", "dog"], "蹄子": ["hoof", "horse", "foot"],
  "犄角": ["horn", "cow", "animal"], "鹿角": ["antler", "deer", "horn"],
  "象牙": ["tusk", "elephant", "ivory"], "獠牙": ["fang", "tooth", "wolf"],
  "鱼鳞": ["fish", "scale", "skin"], "鱼鳍": ["fish", "fin", "swim"],
  "龟壳": ["turtle", "shell", "tortoise"], "毛皮": ["fur", "skin", "coat"],
  "斑纹": ["zebra", "stripe", "pattern"], "条纹": ["stripe", "pattern", "line"],
  "吼叫": ["lion", "roar", "sound"], "汪汪": ["dog", "bark", "paw"],
  "喵喵": ["cat", "meow", "paw"], "叽叽": ["bird", "chick", "sound"],
  "咕咕": ["dove", "pigeon", "sound"], "咩咩": ["sheep", "goat", "sound"],
  "哞哞": ["cow", "moo", "sound"], "嘶鸣": ["horse", "neigh", "sound"],
  "狼嚎": ["wolf", "howl", "moon"], "鸟鸣": ["bird", "song", "sound"],
  "蝉鸣": ["cicada", "insect", "sound"], "蜂鸣": ["bee", "buzz", "sound"],
  // 食物（候选段修正）
  "粥": ["rice", "porridge", "bowl"], "稀饭": ["rice", "porridge", "bowl"],
  "挂面": ["noodles", "pasta", "dry"], "刀削面": ["noodles", "pasta", "knife"],
  "炸酱面": ["noodles", "pasta", "sauce"], "凉面": ["noodles", "pasta", "cold"],
  "米粉": ["noodles", "rice", "pasta"], "河粉": ["noodles", "rice", "pasta"],
  "米线": ["noodles", "rice", "pasta"], "粉丝": ["noodles", "pasta", "glass"],
  "馒头": ["bread", "steamed", "bun"], "包子": ["bun", "bread", "steamed"],
  "饺子": ["dumpling", "food", "jiaozi"], "馄饨": ["dumpling", "soup", "wonton"],
  "云吞": ["dumpling", "soup", "wonton"], "抄手": ["dumpling", "soup", "wonton"],
  "汤圆": ["dumpling", "rice", "ball"], "元宵": ["dumpling", "rice", "ball"],
  "粽子": ["dumpling", "rice", "bamboo"], "年糕": ["rice", "cake", "new-year"],
  "糍粑": ["rice", "cake", "sticky"], "烧饼": ["bread", "baked", "bun"],
  "油条": ["bread", "fried", "stick"], "煎饼": ["pancake", "crepe", "fried"],
  "馅饼": ["pie", "pasty", "filled"], "葱油饼": ["pancake", "scallion", "cake"],
  "可颂": ["bread", "croissant", "pastry"], "贝果": ["bread", "bagel", "breakfast"],
  "法棍": ["bread", "baguette", "french"], "热狗": ["hotdog", "sausage", "bread"],
  "意面": ["pasta", "spaghetti", "noodle"], "通心粉": ["pasta", "macaroni", "noodle"],
  "饭团": ["rice", "ball", "onigiri"], "便当": ["lunch", "box", "bento"],
  "盖浇饭": ["rice", "bowl", "donburi"], "炒饭": ["rice", "fried", "wok"],
  "煲仔饭": ["rice", "pot", "casserole"], "锅巴": ["rice", "crispy", "crust"],
  "燕麦": ["oat", "cereal", "grain"], "麦片": ["cereal", "oat", "breakfast"],
  "红薯": ["potato", "sweet", "vegetable"], "紫薯": ["potato", "purple", "vegetable"],
  "芋头": ["taro", "root", "vegetable"], "山药": ["yam", "root", "vegetable"],
  "猪肉": ["pork", "meat", "pig"], "牛肉": ["beef", "meat", "cow"],
  "羊肉": ["lamb", "meat", "sheep"], "鸡肉": ["chicken", "meat", "poultry"],
  "鸭肉": ["duck", "meat", "poultry"], "鹅肉": ["goose", "meat", "poultry"],
  "鱼肉": ["fish", "meat", "sea"], "虾仁": ["shrimp", "prawn", "sea"],
  "火腿": ["ham", "meat", "pork"], "香肠": ["sausage", "meat", "grill"],
  "培根": ["bacon", "meat", "breakfast"], "腊肉": ["bacon", "cured", "meat"],
  "腊肠": ["sausage", "cured", "meat"], "咸肉": ["bacon", "salted", "meat"],
  "肉丸": ["meat", "ball", "food"], "肉饼": ["meat", "patty", "burger"],
  "肉串": ["meat", "skewer", "kebab"], "鸡翅": ["chicken", "wing", "food"],
  "鸡腿": ["chicken", "leg", "drumstick"], "鸡爪": ["chicken", "foot", "claw"],
  "鸡胸": ["chicken", "breast", "meat"], "猪排": ["pork", "chop", "steak"],
  "羊排": ["lamb", "chop", "steak"], "排骨": ["rib", "meat", "bone"],
  "猪蹄": ["pig", "foot", "meat"], "牛腩": ["beef", "brisket", "meat"],
  "肥牛": ["beef", "fat", "meat"], "五花肉": ["pork", "belly", "meat"],
  "里脊": ["meat", "loin", "pork"], "猪肚": ["tripe", "pig", "stomach"],
  "牛肚": ["tripe", "beef", "stomach"], "毛肚": ["tripe", "beef", "stomach"],
  "鸭脖": ["duck", "neck", "food"], "鸡胗": ["chicken", "gizzard", "food"],
  "鸭肠": ["duck", "intestine", "food"],
  "蛤蜊": ["shell", "clam", "sea"], "花甲": ["shell", "clam", "sea"],
  "蛏子": ["shell", "clam", "sea"], "带鱼": ["fish", "hairtail", "sea"],
  "黄花鱼": ["fish", "yellow", "sea"], "鲳鱼": ["fish", "pomfret", "sea"],
  "秋刀鱼": ["fish", "saury", "sea"], "基围虾": ["shrimp", "prawn", "sea"],
  "小龙虾": ["lobster", "crayfish", "sea"], "北极贝": ["shell", "scallop", "sea"],
  "海蜇": ["jellyfish", "sea", "food"], "鱼籽": ["fish", "egg", "roe"],
  "鱼丸": ["fish", "ball", "food"], "虾滑": ["shrimp", "paste", "food"],
  "白菜": ["cabbage", "vegetable", "leaf"], "菠菜": ["spinach", "vegetable", "leaf"],
  "生菜": ["lettuce", "vegetable", "leaf"], "油麦菜": ["lettuce", "vegetable", "leaf"],
  "空心菜": ["spinach", "vegetable", "water"], "韭菜": ["chive", "vegetable", "leek"],
  "芹菜": ["celery", "vegetable", "green"], "香菜": ["cilantro", "coriander", "herb"],
  "葱": ["scallion", "onion", "herb"], "蒜苗": ["garlic", "sprout", "green"],
  "姜": ["ginger", "root", "spice"], "青椒": ["pepper", "green", "vegetable"],
  "彩椒": ["pepper", "bell", "color"], "小米椒": ["chili", "pepper", "spicy"],
  "冬瓜": ["melon", "winter", "gourd"], "苦瓜": ["melon", "bitter", "gourd"],
  "丝瓜": ["gourd", "loofah", "vegetable"], "豆角": ["bean", "green", "vegetable"],
  "四季豆": ["bean", "green", "vegetable"], "豌豆": ["pea", "bean", "green"],
  "毛豆": ["soybean", "bean", "green"], "黄豆": ["soybean", "bean", "yellow"],
  "豆腐": ["tofu", "bean", "curd"], "豆干": ["tofu", "dried", "bean"],
  "腐竹": ["tofu", "bean", "stick"], "白萝卜": ["radish", "white", "root"],
  "青萝卜": ["radish", "green", "root"], "竹笋": ["bamboo", "shoot", "sprout"],
  "莴笋": ["lettuce", "stem", "vegetable"], "芦笋": ["asparagus", "vegetable", "spear"],
  "莲藕": ["lotus", "root", "vegetable"], "菱角": ["chestnut", "water", "vegetable"],
  "荸荠": ["chestnut", "water", "vegetable"], "菜花": ["cauliflower", "vegetable"],
  "花椰菜": ["cauliflower", "vegetable"], "包菜": ["cabbage", "vegetable"],
  "紫甘蓝": ["cabbage", "purple", "vegetable"], "芥蓝": ["broccoli", "chinese", "vegetable"],
  "菜心": ["vegetable", "green", "choy"], "香菇": ["mushroom", "shiitake", "fungus"],
  "金针菇": ["mushroom", "enoki", "fungus"], "杏鲍菇": ["mushroom", "king", "oyster"],
  "平菇": ["mushroom", "oyster", "fungus"], "木耳": ["mushroom", "wood", "ear"],
  "银耳": ["mushroom", "snow", "fungus"], "海带": ["seaweed", "kelp", "sea"],
  "紫菜": ["seaweed", "nori", "sea"], "豆芽": ["bean", "sprout", "germ"],
  "柚子": ["pomelo", "citrus", "fruit"], "提子": ["grape", "fruit", "bunch"],
  "蓝莓": ["blueberry", "berry", "fruit"], "桑葚": ["mulberry", "berry", "fruit"],
  "树莓": ["raspberry", "berry", "fruit"], "黑莓": ["blackberry", "berry", "fruit"],
  "车厘子": ["cherry", "fruit", "red"], "油桃": ["nectarine", "peach", "fruit"],
  "李子": ["plum", "fruit", "purple"], "杏": ["apricot", "fruit", "orange"],
  "梅子": ["plum", "ume", "fruit"], "枣": ["date", "jujube", "fruit"],
  "红枣": ["date", "red", "jujube"], "冬枣": ["date", "winter", "jujube"],
  "柿子": ["persimmon", "fruit", "orange"], "石榴": ["pomegranate", "fruit", "seed"],
  "火龙果": ["dragon", "fruit", "pitaya"], "哈密瓜": ["melon", "hami", "sweet"],
  "甜瓜": ["melon", "sweet", "fruit"], "香瓜": ["melon", "fragrant", "fruit"],
  "木瓜": ["papaya", "fruit", "tropical"], "榴莲": ["durian", "fruit", "spiky"],
  "山竹": ["mangosteen", "fruit", "tropical"], "荔枝": ["lychee", "fruit", "tropical"],
  "龙眼": ["longan", "fruit", "tropical"], "桂圆": ["longan", "fruit", "dried"],
  "杨梅": ["bayberry", "berry", "fruit"], "枇杷": ["loquat", "fruit", "yellow"],
  "杨桃": ["starfruit", "fruit", "star"], "莲雾": ["fruit", "wax", "apple"],
  "番石榴": ["guava", "fruit", "tropical"], "牛油果": ["avocado", "fruit", "green"],
  "鳄梨": ["avocado", "fruit", "green"], "无花果": ["fig", "fruit", "purple"],
  "山楂": ["hawthorn", "berry", "fruit"], "板栗": ["chestnut", "nut", "brown"],
  "核桃": ["walnut", "nut", "brain"], "开心果": ["pistachio", "nut", "green"],
  "腰果": ["cashew", "nut", "kidney"], "巴旦木": ["almond", "nut", "brown"],
  "杏仁": ["almond", "nut", "white"], "榛子": ["hazelnut", "nut", "brown"],
  "松子": ["pine", "nut", "seed"], "瓜子": ["seed", "sunflower", "snack"],
  "花生": ["peanut", "nut", "legume"],
  "奶油蛋糕": ["cream", "cake", "dessert"], "纸杯蛋糕": ["cupcake", "cake", "dessert"],
  "马卡龙": ["macaron", "cookie", "dessert"], "泡芙": ["cream", "puff", "dessert"],
  "蛋挞": ["egg", "tart", "dessert"], "布丁": ["pudding", "dessert", "custard"],
  "果冻": ["jelly", "dessert", "gelatin"], "雪糕": ["ice", "cream", "bar"],
  "冰棍": ["popsicle", "ice", "bar"], "沙冰": ["shaved", "ice", "dessert"],
  "刨冰": ["shaved", "ice", "dessert"], "奶昔": ["milkshake", "smoothie", "drink"],
  "曲奇": ["cookie", "biscuit", "dessert"], "威化": ["wafer", "cookie", "biscuit"],
  "薯片": ["chips", "crisp", "snack"], "虾条": ["shrimp", "snack", "cracker"],
  "棒棒糖": ["lollipop", "candy", "sweet"], "棉花糖": ["cotton", "candy", "sweet"],
  "泡泡糖": ["bubble", "gum", "candy"], "口香糖": ["gum", "chewing", "candy"],
  "果脯": ["dried", "fruit", "snack"], "蜜饯": ["candied", "fruit", "snack"],
  "肉脯": ["jerky", "meat", "snack"], "牛肉干": ["jerky", "beef", "snack"],
  "鱿鱼丝": ["squid", "snack", "dried"], "海苔": ["seaweed", "nori", "snack"],
  "仙贝": ["senbei", "cracker", "rice"], "米饼": ["rice", "cake", "cracker"],
  "蛋黄酥": ["pastry", "yolk", "dessert"], "绿豆糕": ["cake", "mung", "bean"],
  "桂花糕": ["cake", "osmanthus", "dessert"], "糖葫芦": ["candy", "hawthorn", "stick"],
  "矿泉水": ["water", "mineral", "bottle"], "纯净水": ["water", "pure", "bottle"],
  "苏打水": ["soda", "sparkling", "water"], "气泡水": ["sparkling", "water", "soda"],
  "橙汁": ["orange", "juice", "drink"], "苹果汁": ["apple", "juice", "drink"],
  "柠檬水": ["lemon", "water", "drink"], "雪碧": ["sprite", "soda", "drink"],
  "芬达": ["fanta", "soda", "drink"], "珍珠奶茶": ["tea", "milk", "bubble"],
  "奶茶": ["tea", "milk", "drink"], "美式": ["americano", "coffee", "black"],
  "拿铁": ["latte", "coffee", "milk"], "卡布奇诺": ["cappuccino", "coffee", "foam"],
  "摩卡": ["mocha", "coffee", "chocolate"], "浓缩咖啡": ["espresso", "coffee", "strong"],
  "冷萃": ["cold", "brew", "coffee"], "绿茶": ["green", "tea", "leaf"],
  "红茶": ["black", "tea", "red"], "乌龙茶": ["oolong", "tea", "semi"],
  "普洱茶": ["tea", "pu", "fermented"], "白茶": ["white", "tea", "leaf"],
  "花茶": ["flower", "tea", "jasmine"], "菊花茶": ["chrysanthemum", "tea", "flower"],
  "柠檬茶": ["lemon", "tea", "drink"], "凉茶": ["herbal", "tea", "cool"],
  "豆浆": ["soy", "milk", "drink"], "酸奶": ["yogurt", "milk", "drink"],
  "纯牛奶": ["milk", "pure", "drink"], "奶粉": ["milk", "powder", "formula"],
  "羊奶": ["goat", "milk", "drink"], "豆奶": ["soy", "milk", "drink"],
  "椰汁": ["coconut", "juice", "drink"], "蜂蜜水": ["honey", "water", "drink"],
  "运动饮料": ["sports", "drink", "energy"], "功能饮料": ["energy", "drink", "power"],
  "能量饮料": ["energy", "drink", "boost"], "红牛": ["energy", "drink", "bull"],
  "白酒": ["liquor", "wine", "spirit"], "香槟": ["champagne", "wine", "bubbles"],
  "起泡酒": ["sparkling", "wine", "bubbles"], "威士忌": ["whiskey", "whisky", "alcohol"],
  "白兰地": ["brandy", "alcohol", "wine"], "伏特加": ["vodka", "alcohol", "shot"],
  "朗姆酒": ["rum", "alcohol", "drink"], "鸡尾酒": ["cocktail", "drink", "bar"],
  "米酒": ["rice", "wine", "alcohol"], "黄酒": ["wine", "yellow", "chinese"],
  "清酒": ["sake", "japanese", "rice"], "烧酒": ["soju", "alcohol", "shot"],
  "果酒": ["fruit", "wine", "alcohol"],
  "生抽": ["soy", "sauce", "light"], "老抽": ["soy", "sauce", "dark"],
  "陈醋": ["vinegar", "black", "aged"], "香醋": ["vinegar", "aromatic", "black"],
  "料酒": ["cooking", "wine", "sauce"], "蚝油": ["oyster", "sauce", "seasoning"],
  "味精": ["seasoning", "msg", "flavor"], "鸡精": ["chicken", "seasoning", "msg"],
  "胡椒": ["pepper", "spice", "black"], "花椒": ["peppercorn", "sichuan", "spice"],
  "八角": ["star", "anise", "spice"], "桂皮": ["cinnamon", "bark", "spice"],
  "香叶": ["bay", "leaf", "spice"], "丁香": ["clove", "spice", "flower"],
  "孜然": ["cumin", "spice", "seed"], "辣椒粉": ["chili", "powder", "spice"],
  "五香粉": ["five", "spice", "powder"], "咖喱": ["curry", "spice", "sauce"],
  "番茄酱": ["ketchup", "tomato", "sauce"], "沙拉酱": ["mayonnaise", "dressing", "sauce"],
  "芝麻酱": ["sesame", "paste", "sauce"], "花生酱": ["peanut", "butter", "sauce"],
  "甜面酱": ["sweet", "bean", "sauce"], "豆瓣酱": ["bean", "paste", "sauce"],
  "炼乳": ["condensed", "milk", "sweet"], "橄榄油": ["olive", "oil", "cooking"],
  "食用油": ["oil", "cooking", "frying"], "香油": ["sesame", "oil", "scent"],
  "菜籽油": ["oil", "rapeseed", "cooking"], "面粉": ["flour", "wheat", "powder"],
  "淀粉": ["starch", "cornstarch", "powder"], "酵母": ["yeast", "ferment", "baking"],
  "泡打粉": ["baking", "powder", "leaven"], "火锅底料": ["hotpot", "soup", "base"],
  "火锅": ["hotpot", "pot", "fire"], "汤底": ["broth", "soup", "base"],
  "高汤": ["broth", "stock", "soup"], "卤汁": ["marinade", "sauce", "braise"],
  "腌料": ["marinade", "seasoning", "pickle"],
  // 缺失补充
  "灯笼": ["lantern", "light", "festival"], "扫地机器人": ["robot", "vacuum", "cleaner"],
  "春节": ["lantern", "firework", "new-year"], "长城": ["wall", "china", "great"],
  "故宫": ["palace", "china", "museum"], "牡丹": ["flower", "rose", "blossom"],
  "元宇宙": ["virtual", "vr", "world"], "砧板": ["board", "cutting", "kitchen"],
  "二胡": ["fiddle", "violin", "music"], "元宵节": ["lantern", "festival", "dumpling"],
  "中秋节": ["moon", "festival", "cake"], "端午节": ["dragon", "boat", "festival"],
  "重阳节": ["mountain", "festival", "chrysanthemum"], "圣诞节": ["christmas", "santa", "tree"],
  "万圣节": ["halloween", "pumpkin", "ghost"], "感恩节": ["turkey", "pumpkin", "thanksgiving"],
  "情人节": ["heart", "love", "rose"], "母亲节": ["flower", "heart", "mother"],
  "父亲节": ["gift", "tie", "father"], "儿童节": ["child", "kids", "happy"],
  "教师节": ["teacher", "book", "apple"], "国庆节": ["flag", "china", "star"],
  "劳动节": ["worker", "labor", "wrench"], "妇女节": ["woman", "flower", "female"],
  "青年节": ["youth", "young", "flag"], "建军节": ["army", "soldier", "star"],
  "建党节": ["flag", "party", "star"], "元旦": ["firework", "new-year", "clock"],
  "春节": ["lantern", "firework", "new-year"],
  "除夕": ["lantern", "firework", "family"], "元宵": ["lantern", "dumpling", "festival"],
  "清明": ["rain", "tomb", "spring"], "端午": ["dragon", "boat", "festival"],
  "中秋": ["moon", "cake", "festival"], "重阳": ["mountain", "flower", "festival"],
  "腊八": ["porridge", "rice", "winter"], "小年": ["lantern", "sweep", "festival"],
  "圣诞": ["christmas", "santa", "tree"], "万圣": ["halloween", "pumpkin", "ghost"],
  "复活": ["egg", "rabbit", "easter"],
  // 精确词条补充：即使 forward/reverse 能命中，也补上完全相等的 zh 词条（提升联想精度）
  "羽绒服": ["down", "coat", "jacket"], "火锅": ["hotpot", "pot", "fire"],
  "元宵节": ["lantern", "dumpling", "festival"], "圣诞节": ["christmas", "santa", "tree"],
  "扫地机器人": ["robot", "vacuum", "cleaner"], "火锅底料": ["hotpot", "soup", "base"],
  "吃火锅": ["hotpot", "food", "restaurant"], "圣诞树": ["christmas", "tree", "santa"],
  "圣诞老人": ["santa", "christmas", "snow"], "羽绒被": ["down", "quilt", "duvet"],
  "羽绒枕": ["down", "pillow", "soft"], "元宵": ["dumpling", "rice", "ball"],
};

let added = 0, merged = 0, skipped = 0;
// forceExact: 强制补充精确词条（即使 forward/reverse 已覆盖），提升联想精度
const FORCE = new Set(["羽绒服", "火锅", "元宵节", "圣诞节", "扫地机器人", "火锅底料", "吃火锅", "圣诞树", "圣诞老人", "羽绒被", "羽绒枕", "元宵"]);
for (const [zh, cands] of Object.entries(FIX)) {
  if (covered(zh) && !FORCE.has(zh)) continue;
  const hit = cands.find((c) => segExists(c));
  if (!hit) { skipped++; continue; }
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

const body = dict.map((e) => `  ${JSON.stringify(e)}`).join(",\n");
writeFileSync(DICT_PATH, `[\n${body}\n]\n`);
JSON.parse(readFileSync(DICT_PATH, "utf8"));
console.log(`修复完成：新增 ${added}，并入 ${merged}，跳过 ${skipped}`);
console.log(`zh-dict.json 现共 ${dict.length} 词条`);
