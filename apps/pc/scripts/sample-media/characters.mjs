/**
 * 示例作品《星河旅人》人物的外观参数（程序化插画用）与人物设计文字（写进 seed.json）。
 * 两者描述同一个人，改一处时记得同步另一处。
 */

/** @typedef {{ appearance: string; outfit: string; personality: string }} SampleDesign */

export const SAMPLE_CHARACTER_ART = [
  {
    name: '林舟',
    note: '十七岁 · 束发 · 灰蓝短打 · 背旧剑「青石」 · 左臂缠着绷带',
    heads: 6.8,
    build: 1,
    skin: '#eccaa7',
    hair: { style: 'topknot', color: '#23262e', band: '#8a5a3a' },
    top: { style: 'short-coat', color: '#5f7a92', trim: '#3d5266' },
    pants: '#3a3e48',
    boots: '#4a3a2e',
    belt: '#7a5a3a',
    sword: { sheath: '#5a4632', hilt: '#c9b48a' },
    bandage: true,
    stern: true,
    theme: { top: '#2b3a4a', bottom: '#8aa1b5', glow: '#dfe8f0', mountains: '#24303d', seed: 3 },
    design: {
      appearance: '十七岁，身形清瘦，黑发束成发髻，眉眼倔强；左臂有一道旧伤，常缠着绷带',
      outfit: '灰蓝色交领短打、深色长裤、旧皮靴；背后斜挎秦伯打的旧剑「青石」',
      personality: '倔强、话少，认准的事不回头；对小石头和秦伯很温柔',
    },
  },
  {
    name: '苏晴',
    note: '药师 · 长发发辫 · 草绿长袍 · 背药篓',
    heads: 6.6,
    build: 0.88,
    skin: '#f2d3b8',
    hair: { style: 'long-braid', color: '#3b2a22', band: '#c98f5a' },
    top: { style: 'robe', color: '#6f8f6a', trim: '#e8dcc0' },
    pants: '#5a6b55',
    boots: '#6b5240',
    belt: '#c98f5a',
    basket: true,
    blush: true,
    theme: { top: '#1f3328', bottom: '#7f9d82', glow: '#e3efdc', mountains: '#1b2a22', seed: 5 },
    design: {
      appearance: '深棕长发编成一条发辫搭在肩前，眼睛很亮，笑起来有点坏',
      outfit: '草绿色长袍、米色交领、橙褐腰封；背一只竹编药篓，装着驱狼草和止血草',
      personality: '嘴硬心软，懂草药，遇事比林舟冷静',
    },
  },
  {
    name: '白鸦',
    note: '领航员 · 银白短发 · 黑色长外套 · 左耳罗盘耳坠',
    heads: 7,
    build: 1,
    skin: '#e6c3a0',
    hair: { style: 'shoulder', color: '#d7d9de' },
    top: { style: 'long-coat', color: '#262a33', trim: '#a9b0bc', inner: '#cfd4dc' },
    pants: '#1e2128',
    boots: '#15171c',
    belt: '#3a3f4a',
    earring: true,
    stern: true,
    theme: { top: '#0e1426', bottom: '#2f3d5c', glow: '#b9c6e0', stars: true, seed: 7 },
    design: {
      appearance: '高个，银白色及颌短发，眼神很淡；左耳挂一枚银色罗盘耳坠',
      outfit: '黑色及踝长外套、银色滚边与纽扣、浅灰衬衣、黑长靴',
      personality: '寡言、守信，只说必要的话；对星海航路了如指掌',
    },
  },
  {
    name: '秦伯',
    note: '老铁匠 · 灰发短须 · 挽起袖子 · 皮围裙 · 铁锤',
    heads: 6.4,
    build: 1.2,
    skin: '#d9b08c',
    hair: { style: 'gray-short', color: '#9a9a98' },
    beard: '#b4b3ae',
    top: { style: 'shirt', color: '#8a7a64', trim: '#6e604c' },
    apron: '#6b4a32',
    pants: '#4a443c',
    boots: '#3a2e24',
    rolledSleeves: true,
    hammer: true,
    stern: true,
    theme: { top: '#2a1a12', bottom: '#8a4a26', glow: '#ffc58a', sparks: true, seed: 9 },
    design: {
      appearance: '五十多岁，灰白短发和短须，手臂粗壮，满是烫伤的旧疤',
      outfit: '褐色粗布衣挽起袖子，系一条厚皮围裙，手里常拎着铁锤',
      personality: '嗜酒、嘴上不饶人，手艺极好；把林舟当亲儿子',
    },
  },
  {
    name: '小石头',
    note: '八岁 · 乱糟糟的短发 · 打补丁的短衫 · 光脚',
    heads: 4.8,
    build: 0.9,
    skin: '#efc29a',
    hair: { style: 'spiky', color: '#2a2420' },
    top: { style: 'tunic', color: '#b5895a', trim: '#8c6a44' },
    patch: '#8c6a44',
    pants: '#6d5d4a',
    shorts: true,
    barefoot: true,
    blush: true,
    theme: { top: '#5a4632', bottom: '#d9b88a', glow: '#fff0d0', mountains: '#6d5a44', seed: 13 },
    design: {
      appearance: '八岁，头发乱糟糟地翘着，脸蛋晒得黑红，总是光着脚',
      outfit: '打着补丁的土黄短衫、短裤',
      personality: '黏人、认真，答应的事一定做到',
    },
  },
];

/** 设定配图：设定标题 → 绘制函数名 */
export const SAMPLE_LORE_ART = [
  { title: '星辉灯塔', render: 'renderLighthouse' },
  { title: '星港城商会', render: 'renderHarbor' },
];
