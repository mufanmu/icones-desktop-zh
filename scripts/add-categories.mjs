#!/usr/bin/env node
// 扩充 zh-dict.json 生活化大类 + 补齐缺失词段，并同步 zh-root.json 词根表。
// 覆盖大类：人物/美女、发型/美容、服饰穿搭、动物、食物、表情情绪、身体部位、运动、通用动作。
// 合并语义：单段按 gen-dict union（en 含 seg → 并 zh；zh 有交集 → 并 en；否则 append）；
//           大类词条按 en 集合查重后 append（保留多 en 关联，保证搜「美女」能展开多词）。
// 词根表：缺失段才写入，不覆盖已有。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DICT_PATH = join(ROOT, "public", "zh-dict.json");
const ROOT_TABLE_PATH = join(ROOT, "scripts", "zh-root.json");

// ============ 单段翻译：补齐缺失词段（union 合并进字典） ============
const SEGMENTS = {
  // 人物
  wrestling: ["摔跤"], women: ["女人", "女性"], men: ["男人", "男性"],
  bunny: ["兔子"], adult: ["成人", "成年人"], human: ["人类"],
  bride: ["新娘"], groom: ["新郎"], lady: ["女士", "淑女"], queen: ["女王"],
  king: ["国王"], princess: ["公主"], baby: ["婴儿", "宝宝"],
  // 发型 / 美容
  curly: ["卷发", "卷曲"], turban: ["头巾"], haircut: ["理发", "剪发"],
  bald: ["光头", "秃头"], blonde: ["金发"], beard: ["胡子", "胡须"],
  moustache: ["胡子", "八字胡"], mustache: ["胡子", "八字胡"],
  comb: ["梳子"], razor: ["剃刀", "刮胡刀"], barber: ["理发师", "理发店"],
  lipstick: ["口红", "唇膏"], eyebrow: ["眉毛"], eyelash: ["睫毛"],
  mascara: ["睫毛膏"], blush: ["腮红"], foundation: ["粉底"],
  cosmetic: ["化妆品"], cosmetics: ["化妆品"], perfume: ["香水"],
  lotion: ["乳液", "润肤露"], cream: ["面霜", "奶油"], facial: ["美容", "面部"],
  spa: ["水疗"], massage: ["按摩"], manicure: ["美甲"],
  // 服饰
  dress: ["连衣裙", "礼服"], tshirt: ["T恤", "短袖"], pants: ["裤子"],
  trousers: ["长裤", "西裤"], jeans: ["牛仔裤"], shorts: ["短裤"],
  skirt: ["裙子", "半身裙"], suit: ["西装", "套装"], kimono: ["和服"],
  uniform: ["制服", "校服"], apron: ["围裙"], vest: ["背心", "马甲"],
  sweater: ["毛衣", "针织衫"], hoodie: ["卫衣", "连帽衫"], coat: ["外套", "大衣"],
  jacket: ["夹克"], collar: ["衣领", "领子"], sleeve: ["袖子"],
  zipper: ["拉链"], pocket: ["口袋"], tie: ["领带", "打结"],
  belt: ["腰带", "皮带"], scarf: ["围巾"], gloves: ["手套"],
  socks: ["袜子"], boots: ["靴子"], slippers: ["拖鞋"],
  swimsuit: ["泳衣"], bikini: ["比基尼"], jewelry: ["珠宝", "首饰"],
  necklace: ["项链"], earring: ["耳环"], crown: ["皇冠", "王冠"],
  sunglasses: ["墨镜", "太阳镜"], handbag: ["手提包"], purse: ["手提包", "钱包"],
  // 动物
  chick: ["小鸡", "雏鸟"], rooster: ["公鸡"], goose: ["鹅"], turkey: ["火鸡"],
  peacock: ["孔雀"], owl: ["猫头鹰"], eagle: ["老鹰"], hawk: ["老鹰", "隼"],
  parrot: ["鹦鹉"], penguin: ["企鹅"], hamster: ["仓鼠"], bunny: ["兔子"],
  rat: ["老鼠"], lion: ["狮子"], tiger: ["老虎"], bear: ["熊"], wolf: ["狼"],
  fox: ["狐狸"], elephant: ["大象"], giraffe: ["长颈鹿"], zebra: ["斑马"],
  monkey: ["猴子"], panda: ["熊猫"], koala: ["考拉"], kangaroo: ["袋鼠"],
  dolphin: ["海豚"], shark: ["鲨鱼"], whale: ["鲸鱼"], crab: ["螃蟹"],
  lobster: ["龙虾"], shrimp: ["虾"], snail: ["蜗牛"], turtle: ["乌龟"],
  frog: ["青蛙"], snake: ["蛇"], spider: ["蜘蛛"], bee: ["蜜蜂"],
  butterfly: ["蝴蝶"], ant: ["蚂蚁"], unicorn: ["独角兽"], dinosaur: ["恐龙"],
  dragon: ["龙"], donkey: ["驴"], buffalo: ["水牛"], camel: ["骆驼"],
  deer: ["鹿"], squirrel: ["松鼠"], hedgehog: ["刺猬"], paw: ["爪子", "爪印"],
  wing: ["翅膀"], tail: ["尾巴"], horn: ["角", "喇叭"], fur: ["毛皮", "皮毛"],
  feather: ["羽毛"], claw: ["爪子"], beak: ["鸟喙", "喙"],
  // 食物
  apple: ["苹果"], banana: ["香蕉"], orange: ["橙子", "橘子"], grape: ["葡萄"],
  strawberry: ["草莓"], watermelon: ["西瓜"], cherry: ["樱桃"], peach: ["桃子"],
  lemon: ["柠檬"], pineapple: ["菠萝"], mango: ["芒果"], pear: ["梨"],
  kiwi: ["猕猴桃"], coconut: ["椰子"], tomato: ["番茄", "西红柿"],
  potato: ["土豆", "马铃薯"], carrot: ["胡萝卜"], onion: ["洋葱"],
  garlic: ["大蒜"], pepper: ["辣椒", "胡椒"], corn: ["玉米"],
  cabbage: ["卷心菜", "白菜"], broccoli: ["西兰花"], cucumber: ["黄瓜"],
  pumpkin: ["南瓜"], mushroom: ["蘑菇"], eggplant: ["茄子"], salad: ["沙拉"],
  bread: ["面包"], cake: ["蛋糕"], cookie: ["饼干"], candy: ["糖果"],
  chocolate: ["巧克力"], icecream: ["冰淇淋"], donut: ["甜甜圈"],
  pizza: ["披萨", "比萨"], hamburger: ["汉堡", "汉堡包"], burger: ["汉堡"],
  fries: ["薯条"], noodle: ["面条"], noodles: ["面条"], rice: ["米饭", "大米"],
  sushi: ["寿司"], ramen: ["拉面"], sandwich: ["三明治"], taco: ["墨西哥卷饼"],
  steak: ["牛排"], egg: ["鸡蛋"], cheese: ["奶酪", "芝士"], butter: ["黄油"],
  milk: ["牛奶"], juice: ["果汁"], wine: ["红酒", "葡萄酒"], soda: ["汽水"],
  cola: ["可乐"], meal: ["餐", "一顿饭"], breakfast: ["早餐"], lunch: ["午餐"],
  dinner: ["晚餐"], dessert: ["甜点", "甜品"], snack: ["零食"],
  restaurant: ["餐厅", "饭店"], cook: ["厨师", "烹饪"], cooking: ["烹饪", "做饭"],
  chef: ["厨师", "大厨"], kitchen: ["厨房"], pan: ["平底锅"], pot: ["锅", "壶"],
  bowl: ["碗"], plate: ["盘子", "餐盘"], cup: ["杯子"], fork: ["叉子"],
  spoon: ["勺子", "汤匙"], knife: ["刀", "刀具"], chopsticks: ["筷子"],
  grill: ["烤架", "烧烤"], barbecue: ["烧烤", "烤肉"],
  // 表情 / 情绪
  smiley: ["笑脸"], grin: ["露齿笑", "咧嘴笑"], grimace: ["鬼脸", "做鬼脸"],
  frown: ["皱眉"], frowning: ["皱眉"], wink: ["眨眼", "媚眼"], kiss: ["吻", "亲吻"],
  cry: ["哭", "哭泣"], crying: ["哭泣", "大哭"], angry: ["生气", "愤怒"],
  sad: ["难过", "悲伤"], happy: ["开心", "快乐"], joy: ["喜悦", "欢乐"],
  love: ["爱", "爱心"], like: ["喜欢", "点赞"], dislike: ["不喜欢", "踩"],
  fear: ["恐惧", "害怕"], scared: ["害怕", "惊恐"], shocked: ["震惊", "惊吓"],
  surprise: ["惊喜", "惊讶"], surprised: ["惊讶", "吃惊"], confused: ["困惑", "疑惑"],
  embarrassed: ["尴尬", "难为情"], proud: ["骄傲", "自豪"], worried: ["担心", "忧虑"],
  tired: ["累", "疲惫"], sleepy: ["困", "困倦"], sick: ["生病", "恶心"],
  cool: ["酷", "冷静"], nerd: ["书呆子", "眼镜男"], flushed: ["脸红", "害羞"],
  expression: ["表情", "面部表情"], emotion: ["情绪", "情感"], mood: ["心情", "情绪"],
  // 身体部位
  hand: ["手"], hands: ["手"], finger: ["手指"], fingers: ["手指"],
  thumb: ["拇指", "点赞"], fist: ["拳头"], palm: ["手掌"], wrist: ["手腕"],
  elbow: ["手肘", "肘"], arm: ["手臂"], arms: ["手臂"], shoulder: ["肩膀"],
  leg: ["腿"], legs: ["腿"], knee: ["膝盖"], foot: ["脚", "足"], feet: ["脚", "足"],
  eye: ["眼睛"], eyes: ["眼睛"], ear: ["耳朵"], ears: ["耳朵"], nose: ["鼻子"],
  mouth: ["嘴巴", "嘴"], lips: ["嘴唇"], tooth: ["牙齿"], teeth: ["牙齿"],
  tongue: ["舌头"], head: ["头", "头部"], neck: ["脖子", "颈部"],
  brain: ["大脑", "脑子"], lung: ["肺"], muscle: ["肌肉"], bone: ["骨头", "骨骼"],
  // 运动
  running: ["跑步", "奔跑"], run: ["跑步", "奔跑"], walking: ["走路", "步行"],
  walk: ["走路", "步行"], jump: ["跳跃", "跳"], jumping: ["跳跃"],
  swim: ["游泳"], swimming: ["游泳"], dance: ["跳舞", "舞蹈"], dancing: ["跳舞"],
  yoga: ["瑜伽"], exercise: ["锻炼", "运动"], workout: ["健身", "锻炼"],
  biking: ["骑行", "骑自行车"], cycling: ["骑行", "骑自行车"], skate: ["滑冰", "滑板"],
  skating: ["滑冰", "溜冰"], surf: ["冲浪"], surfing: ["冲浪"],
  kayak: ["皮划艇"], rowing: ["划船"], climbing: ["攀岩", "攀爬"],
  hiking: ["徒步", "远足"], golf: ["高尔夫"], tennis: ["网球"],
  soccer: ["足球"], football: ["足球", "橄榄球"], basketball: ["篮球"],
  baseball: ["棒球"], volleyball: ["排球"], badminton: ["羽毛球"],
  boxing: ["拳击"], fencing: ["击剑"], ski: ["滑雪", "滑雪板"],
  praying: ["祈祷", "祷告"], pray: ["祈祷", "祷告"], salute: ["敬礼"],
  saluting: ["敬礼"], clap: ["鼓掌"], clapping: ["鼓掌"], hugging: ["拥抱"],
  hug: ["拥抱"], waving: ["挥手", "招手"], wave: ["挥手", "波浪"],
  pointing: ["指向", "指点"], point: ["指向", "点"],
  // 通用
  wearing: ["穿戴", "穿着"], standing: ["站立", "站着"], sitting: ["坐", "坐着"],
  sleeping: ["睡觉", "睡眠"], sleep: ["睡觉", "睡眠"], model: ["模特", "模型"],
  style: ["风格", "样式"], beauty: ["美丽", "美女"], beautiful: ["美丽", "漂亮"],
  pretty: ["漂亮", "可爱"], fashion: ["时尚", "潮流"], emoji: ["表情", "表情符号"],
  faces: ["脸", "面孔"], face: ["脸", "面部"], body: ["身体", "人体"],
  // 大类词
  animal: ["动物", "野兽"], animals: ["动物"], pet: ["宠物"], pets: ["宠物"],
  cookware: ["厨具", "炊具"], kitchenware: ["厨具", "厨房用品"],
  // 口语常用（低频段也收，用户会直接搜）
  wedding: ["婚礼", "结婚"], marriage: ["婚礼", "结婚"], married: ["结婚"],
  eat: ["吃饭", "进食"], eating: ["吃饭", "用餐"], dining: ["吃饭", "用餐"],
  sing: ["唱歌", "演唱"], song: ["唱歌", "歌曲", "音乐"], singing: ["唱歌"],
  music: ["音乐", "歌曲"], guitar: ["吉他"], piano: ["钢琴"], drum: ["鼓", "架子鼓"],
  microphone: ["麦克风", "话筒"], heels: ["高跟鞋", "鞋跟"], heel: ["高跟鞋", "鞋跟"],
};

// ============ 大类词条：中文大类词 → 多英文展开（append 保留多 en） ============
const CATEGORIES = [
  // 人物 / 美女
  { en: ["woman", "women", "girl", "girls", "lady", "ladies", "beauty", "beautiful", "pretty", "model", "bride", "princess", "fashion"], zh: ["美女", "美人", "女人", "女孩", "女士", "淑女", "仙女"] },
  { en: ["man", "men", "boy", "gentleman", "king", "groom", "adult", "human"], zh: ["男人", "男士", "帅哥", "男孩", "人类", "成人"] },
  // 发型 / 美容
  { en: ["hair", "hairstyle", "haircut", "hairline"], zh: ["发型", "头发", "理发", "剪发"] },
  { en: ["beard", "moustache", "mustache", "razor", "barber", "bald", "curly", "blonde", "bun", "braid", "ponytail", "wig", "comb", "shave"], zh: ["胡子", "胡须", "剃须", "理发师", "光头", "秃头", "卷发", "金发", "丸子头", "辫子", "马尾", "假发", "梳子"] },
  { en: ["makeup", "lipstick", "cosmetic", "cosmetics", "eyebrow", "eyelash", "mascara", "blush", "foundation", "perfume", "nail", "manicure", "lotion", "cream", "facial", "spa", "massage", "mirror", "towel", "soap", "shampoo"], zh: ["化妆", "美妆", "妆容", "口红", "化妆品", "眉毛", "睫毛", "腮红", "粉底", "香水", "美甲", "指甲", "乳液", "面霜", "护肤", "美容", "水疗", "按摩", "镜子", "毛巾", "肥皂", "洗发水"] },
  // 服饰穿搭
  { en: ["dress", "shirt", "tshirt", "pants", "trousers", "jeans", "shorts", "skirt", "suit", "uniform", "clothes", "clothing"], zh: ["连衣裙", "礼服", "衬衫", "T恤", "裤子", "牛仔裤", "短裤", "裙子", "西装", "制服", "衣服", "服装"] },
  { en: ["hat", "cap", "coat", "jacket", "sweater", "hoodie", "vest", "apron", "kimono", "scarf", "tie", "belt", "pocket", "collar", "sleeve", "zipper", "button"], zh: ["帽子", "外套", "夹克", "毛衣", "卫衣", "背心", "围裙", "和服", "围巾", "领带", "腰带", "口袋", "衣领", "袖子", "拉链", "纽扣"] },
  { en: ["shoes", "boots", "sneakers", "slippers", "socks", "gloves"], zh: ["鞋子", "靴子", "运动鞋", "拖鞋", "袜子", "手套"] },
  { en: ["bag", "purse", "handbag", "wallet", "sunglasses", "glasses", "watch", "necklace", "ring", "earring", "jewelry", "crown", "umbrella"], zh: ["包", "手提包", "钱包", "墨镜", "眼镜", "手表", "项链", "戒指", "耳环", "珠宝", "皇冠", "雨伞"] },
  // 动物
  { en: ["animal", "animals", "pet", "pets", "cat", "kitten", "dog", "puppy", "rabbit", "bunny", "hamster", "mouse", "rat"], zh: ["动物", "宠物", "猫", "狗", "兔子", "仓鼠", "老鼠", "小猫", "小狗"] },
  { en: ["bird", "chick", "owl", "eagle", "hawk", "parrot", "rooster", "chicken", "duck", "goose", "turkey", "peacock", "penguin", "feather", "wing", "claw", "beak"], zh: ["鸟", "小鸡", "猫头鹰", "老鹰", "鹦鹉", "公鸡", "鸡", "鸭", "鹅", "火鸡", "孔雀", "企鹅", "羽毛", "翅膀", "爪", "喙"] },
  { en: ["fish", "shark", "whale", "dolphin", "crab", "lobster", "shrimp", "snail", "turtle", "frog", "snake", "spider", "bee", "butterfly", "ant", "bug"], zh: ["鱼", "鲨鱼", "鲸鱼", "海豚", "螃蟹", "龙虾", "虾", "蜗牛", "乌龟", "青蛙", "蛇", "蜘蛛", "蜜蜂", "蝴蝶", "蚂蚁", "虫子"] },
  { en: ["horse", "cow", "pig", "sheep", "goat", "buffalo", "donkey", "camel", "deer", "elephant", "giraffe", "zebra", "monkey", "panda", "koala", "kangaroo", "lion", "tiger", "bear", "wolf", "fox", "squirrel", "hedgehog", "paw", "tail", "horn", "fur"], zh: ["马", "牛", "猪", "羊", "山羊", "水牛", "驴", "骆驼", "鹿", "大象", "长颈鹿", "斑马", "猴子", "熊猫", "考拉", "袋鼠", "狮子", "老虎", "熊", "狼", "狐狸", "松鼠", "刺猬", "爪子", "尾巴", "角", "皮毛"] },
  { en: ["dragon", "dinosaur", "unicorn"], zh: ["龙", "恐龙", "独角兽"] },
  // 食物
  { en: ["fruit", "apple", "banana", "orange", "grape", "strawberry", "watermelon", "cherry", "peach", "lemon", "pineapple", "mango", "pear", "kiwi", "coconut"], zh: ["水果", "苹果", "香蕉", "橙子", "葡萄", "草莓", "西瓜", "樱桃", "桃子", "柠檬", "菠萝", "芒果", "梨", "猕猴桃", "椰子"] },
  { en: ["vegetable", "tomato", "potato", "carrot", "onion", "garlic", "pepper", "corn", "cabbage", "broccoli", "cucumber", "pumpkin", "mushroom", "eggplant", "salad"], zh: ["蔬菜", "番茄", "土豆", "胡萝卜", "洋葱", "大蒜", "辣椒", "玉米", "卷心菜", "西兰花", "黄瓜", "南瓜", "蘑菇", "茄子", "沙拉"] },
  { en: ["bread", "cake", "cookie", "candy", "chocolate", "icecream", "donut", "pizza", "hamburger", "burger", "fries", "noodle", "noodles", "rice", "sushi", "ramen", "sandwich", "taco", "steak", "egg", "cheese", "butter", "grill", "barbecue"], zh: ["面包", "蛋糕", "饼干", "糖果", "巧克力", "冰淇淋", "甜甜圈", "披萨", "汉堡", "薯条", "面条", "米饭", "寿司", "拉面", "三明治", "牛排", "鸡蛋", "奶酪", "黄油", "烧烤"] },
  { en: ["milk", "coffee", "tea", "juice", "water", "beer", "wine", "soda", "cola"], zh: ["牛奶", "咖啡", "茶", "果汁", "水", "啤酒", "红酒", "汽水", "可乐"] },
  { en: ["food", "meal", "breakfast", "lunch", "dinner", "dessert", "snack", "restaurant", "cook", "cooking", "chef", "kitchen", "pan", "pot", "bowl", "plate", "cup", "fork", "spoon", "knife", "chopsticks"], zh: ["食物", "餐", "早餐", "午餐", "晚餐", "甜点", "零食", "餐厅", "厨师", "厨房", "锅", "碗", "盘子", "杯子", "叉子", "勺子", "刀", "筷子"] },
  // 表情情绪
  { en: ["smile", "smiley", "grin", "laugh", "happy", "joy", "cool"], zh: ["微笑", "笑脸", "大笑", "开心", "高兴", "喜悦", "快乐", "酷"] },
  { en: ["cry", "crying", "sad", "frown", "frowning", "grimace", "tired", "sleepy", "sick", "worried", "confused", "embarrassed", "flushed", "surprise", "surprised", "shocked", "scared", "fear", "angry", "nerd", "emotion", "mood", "expression"], zh: ["哭", "哭泣", "悲伤", "难过", "皱眉", "鬼脸", "累", "疲惫", "困", "生病", "担心", "困惑", "尴尬", "脸红", "惊讶", "震惊", "害怕", "恐惧", "生气", "愤怒", "情绪", "心情", "表情"] },
  { en: ["kiss", "wink", "love", "like", "dislike", "hug", "hugging", "clap", "clapping", "salute", "saluting", "wave", "waving", "pray", "praying", "point", "pointing", "thumb", "fist", "palm"], zh: ["吻", "亲吻", "眨眼", "爱", "喜欢", "点赞", "不喜欢", "拥抱", "鼓掌", "敬礼", "挥手", "打招呼", "祈祷", "许愿", "指向", "指点", "拇指", "拳头", "手掌"] },
  // 身体部位
  { en: ["hand", "hands", "finger", "fingers", "wrist", "elbow", "arm", "arms", "shoulder", "leg", "legs", "knee", "foot", "feet"], zh: ["手", "手指", "手腕", "手肘", "手臂", "肩膀", "腿", "膝盖", "脚", "足"] },
  { en: ["eye", "eyes", "ear", "ears", "nose", "mouth", "lips", "tooth", "teeth", "tongue", "head", "neck", "brain", "lung", "heart", "bone", "muscle", "body"], zh: ["眼睛", "耳朵", "鼻子", "嘴巴", "嘴唇", "牙齿", "舌头", "头", "脖子", "大脑", "肺", "心脏", "骨头", "肌肉", "身体"] },
  // 运动
  { en: ["sport", "sports", "exercise", "workout", "running", "run", "walk", "walking", "jump", "jumping", "swim", "swimming", "dance", "dancing", "yoga", "meditation"], zh: ["运动", "锻炼", "健身", "跑步", "跑", "走路", "步行", "跳跃", "跳", "游泳", "跳舞", "舞蹈", "瑜伽", "冥想"] },
  { en: ["biking", "cycling", "skate", "skating", "surf", "surfing", "kayak", "rowing", "climbing", "hiking", "wrestling"], zh: ["骑行", "骑自行车", "滑冰", "滑板", "冲浪", "皮划艇", "划船", "攀岩", "爬山", "徒步", "摔跤"] },
  { en: ["golf", "tennis", "soccer", "football", "basketball", "baseball", "volleyball", "badminton", "ping", "bowling", "boxing", "fencing", "ski", "skiing"], zh: ["高尔夫", "网球", "足球", "橄榄球", "篮球", "棒球", "排球", "羽毛球", "乒乓球", "保龄球", "拳击", "击剑", "滑雪"] },
  // 音乐 / 生活口语
  { en: ["music", "song", "sing", "singing", "guitar", "piano", "drum", "microphone", "headphone", "headphones", "speaker", "radio"], zh: ["音乐", "歌曲", "唱歌", "演唱", "吉他", "钢琴", "鼓", "麦克风", "耳机", "音响", "收音机"] },
  { en: ["wedding", "marriage", "married", "bride", "groom", "ring", "cake"], zh: ["婚礼", "结婚", "新娘", "新郎", "戒指", "婚戒", "蛋糕"] },
  { en: ["eat", "eating", "dining", "meal", "food", "restaurant", "breakfast", "lunch", "dinner"], zh: ["吃饭", "用餐", "进食", "就餐", "餐厅", "美食"] },
  { en: ["heels", "heel", "shoes", "boots", "sneakers", "slippers"], zh: ["高跟鞋", "鞋跟", "鞋子", "靴子", "运动鞋", "拖鞋"] },
];

// ============ 合并逻辑 ============
function main() {
  const dict = JSON.parse(readFileSync(DICT_PATH, "utf8"));
  const rootTable = JSON.parse(readFileSync(ROOT_TABLE_PATH, "utf8"));

  let segMerged = 0, segAdded = 0, catAdded = 0, catMerged = 0, rootAdded = 0, cleanN = 0;

  // 0) 清理历史噪音词条：gen-dict 早期把 animal 误译成「鼠标动物」挂到 mouse 上，
  //    导致搜「动物」命中鼠标。移除该噪音 zh，并把该词条修正为纯粹的鼠类。
  for (const e of dict) {
    const hasNoise = e.zh.some((z) => z.includes("鼠标动物"));
    if (hasNoise) {
      e.zh = e.zh.filter((z) => !z.includes("鼠标动物"));
      e.zh.push("老鼠", "耗子");
      if (!e.en.includes("rat")) e.en.push("rat");
      cleanN++;
    }
  }

  // 1) 单段 union 合并
  for (const [seg, zhs] of Object.entries(SEGMENTS)) {
    const byEn = dict.find((e) => e.en.includes(seg));
    const byZh = dict.find((e) => e.zh.some((z) => zhs.includes(z)));
    if (byEn) {
      for (const z of zhs) if (!byEn.zh.includes(z)) byEn.zh.push(z);
      segMerged++;
    } else if (byZh) {
      if (!byZh.en.includes(seg)) byZh.en.push(seg);
      segMerged++;
    } else {
      dict.push({ en: [seg], zh: zhs });
      segAdded++;
    }
  }

  // 2) 大类词条 append（en 集合完全相同则合并 zh，否则保留多 en 关联）
  for (const cat of CATEGORIES) {
    const key = [...cat.en].sort().join("|");
    const same = dict.find((e) => [...e.en].sort().join("|") === key);
    if (same) {
      for (const z of cat.zh) if (!same.zh.includes(z)) same.zh.push(z);
      catMerged++;
      continue;
    }
    // 若 zh 组合已存在（防重复 append）
    const byZh = dict.find((e) => cat.zh.every((z) => e.zh.includes(z)) && cat.en.every((en) => e.en.includes(en)));
    if (byZh) { catMerged++; continue; }
    dict.push(cat);
    catAdded++;
  }

  // 3) 同步词根表（缺失段才写）
  for (const [seg, zhs] of Object.entries(SEGMENTS)) {
    if (!rootTable[seg]) { rootTable[seg] = zhs; rootAdded++; }
  }

  // 整体重写，保持单行数组风格
  const body = dict.map((e) => `  ${JSON.stringify(e)}`).join(",\n");
  writeFileSync(DICT_PATH, `[\n${body}\n]\n`);
  JSON.parse(readFileSync(DICT_PATH, "utf8")); // 自校验

  writeFileSync(ROOT_TABLE_PATH, JSON.stringify(rootTable, null, 2) + "\n");
  JSON.parse(readFileSync(ROOT_TABLE_PATH, "utf8"));

  console.log(`单段: 合并 ${segMerged} / 新增 ${segAdded}`);
  console.log(`大类: 合并 ${catMerged} / 新增 ${catAdded}`);
  console.log(`词根表新增 ${rootAdded} 条 → 共 ${Object.keys(rootTable).length}`);
  console.log(`zh-dict.json 现共 ${dict.length} 词条，清理噪音词条 ${cleanN} 条`);
}

main();
