/**
 * 人物 / 设定的「设计 + 图集」模型（纯函数，GUI 渲染进程、主进程与 CLI 共用）
 *
 * - 图集：一组图片（形象图、三视图、服装、表情、背景、概念图…），其中一张选为封面（人物的「形象图」）；
 *   封面在人物详情显示为竖版大图，在列表 / 悬停卡片 / 场景视频等引用处裁成小圆头像
 * - 图片文件保存在 `<作品>/资料/图集/人物|设定/<名称>/`，AI 生成的图片旁边有同名 `.prompt.json`，可复现
 * - 人物设计（外形、行为、经历、动机与成长）保存在人物卡 attributes.design；
 *   AI 出图、续写、场景视频都从这里读取，保证人物「不崩」
 * - 设定支持多级分类（folder，例如「地理/北境」）与标签
 */

export type EntityKind = 'character' | 'lore';

export type MediaKind =
  | 'portrait'
  | 'turnaround'
  | 'outfit'
  | 'expression'
  | 'background'
  | 'concept'
  | 'other';

export interface MediaKindOption {
  kind: MediaKind;
  label: string;
  /** 一句话说明（选择类型时显示） */
  hint: string;
  /** 默认出图比例 */
  aspectRatio: string;
}

/**
 * 人物只分两类：三视图（生成视频时保持人物不崩的参考）与形象图（其余所有图：立绘、服装、表情、背景…）；
 * 形象图里选一张作为「主要形象图」（封面）。旧数据中的其他类型一律按形象图显示
 */
export const CHARACTER_MEDIA_KINDS: readonly MediaKindOption[] = [
  {
    kind: 'portrait',
    label: '形象图',
    hint: '立绘、服装、表情、场景里的人物都算形象图；选一张作为主要形象图',
    aspectRatio: '3:4',
  },
  {
    kind: 'turnaround',
    label: '三视图',
    hint: '正面 / 侧面 / 背面同一张图，生成视频时用来保持人物不崩',
    aspectRatio: '16:9',
  },
];

/** 设定只有一类「图片」，选一张作为封面 */
export const LORE_MEDIA_KINDS: readonly MediaKindOption[] = [
  {
    kind: 'concept',
    label: '图片',
    hint: '地点 / 物品 / 势力的样貌，也可作为场景视频的背景',
    aspectRatio: '16:9',
  },
];

/** 旧类型归并到当前的分类（人物：三视图之外都是形象图；设定：都是图片） */
export function normalizeMediaKind(entity: EntityKind, kind: MediaKind): MediaKind {
  if (entity === 'lore') return 'concept';
  return kind === 'turnaround' ? 'turnaround' : 'portrait';
}

/** 封面在界面上的叫法 */
export const COVER_LABEL: Record<EntityKind, string> = {
  character: '主要形象图',
  lore: '封面',
};

export const IMAGE_STYLES = ['写实', '国漫', '水墨', '厚涂插画', '电影感'] as const;

export const ENTITY_MEDIA_ROOT = ['资料', '图集'] as const;
export const ENTITY_MEDIA_SUBDIR: Record<EntityKind, string> = {
  character: '人物',
  lore: '设定',
};

export interface MediaItem {
  id: string;
  /** 相对作品目录的路径（资料/图集/…） */
  path: string;
  kind: MediaKind;
  label?: string;
  source: 'upload' | 'ai';
  /** AI 生成时的提示词 */
  prompt?: string;
  createdAt: string;
}

const MEDIA_KINDS = new Set<MediaKind>([
  'portrait',
  'turnaround',
  'outfit',
  'expression',
  'background',
  'concept',
  'other',
]);
export const MEDIA_ITEMS_MAX = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 只接受作品目录内的相对路径（不允许 `..`、绝对路径、反斜杠开头） */
export function isSafeMediaPath(value: string): boolean {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  return value.split(/[\\/]/).every((part) => part !== '..' && part !== '.' && part !== '');
}

/** 读取图集：丢弃无效项与重复路径，最多 MEDIA_ITEMS_MAX 张 */
export function parseMediaItems(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: MediaItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const path = str(entry.path);
    if (!isSafeMediaPath(path) || seen.has(path)) continue;
    seen.add(path);
    const kind = MEDIA_KINDS.has(entry.kind as MediaKind) ? (entry.kind as MediaKind) : 'other';
    const item: MediaItem = {
      id: str(entry.id) || path,
      path,
      kind,
      source: entry.source === 'ai' ? 'ai' : 'upload',
      createdAt: str(entry.createdAt) || new Date(0).toISOString(),
    };
    const label = str(entry.label);
    if (label) item.label = label;
    const prompt = str(entry.prompt);
    if (prompt) item.prompt = prompt;
    items.push(item);
    if (items.length >= MEDIA_ITEMS_MAX) break;
  }
  return items;
}

/** 新图片放在最前；同路径不重复 */
export function addMediaItems(
  items: readonly MediaItem[],
  added: readonly MediaItem[]
): MediaItem[] {
  const paths = new Set(added.map((item) => item.path));
  return [...added, ...items.filter((item) => !paths.has(item.path))].slice(0, MEDIA_ITEMS_MAX);
}

export function removeMediaItem(items: readonly MediaItem[], id: string): MediaItem[] {
  return items.filter((item) => item.id !== id);
}

/**
 * 封面：作者选过且仍在图集里的图片；否则第一张形象图 / 概念图；否则第一张；
 * 图集为空时沿用旧的单张头像（attributes.avatar，可能是 资料/人物头像/ 下的文件或 data URL）
 */
export function resolveCover(
  items: readonly MediaItem[] | undefined,
  cover: string | undefined,
  legacyAvatar?: string
): string | undefined {
  const list = items ?? [];
  if (cover && list.some((item) => item.path === cover)) return cover;
  if (list.length === 0) return legacyAvatar?.trim() || cover || undefined;
  const preferred = list.find((item) => item.kind === 'portrait' || item.kind === 'concept');
  return (preferred ?? list[0]).path;
}

/** 按类型分组（保持类型选项的顺序；不在选项里的旧类型归入第一个选项） */
export function groupMediaItems(
  items: readonly MediaItem[],
  options: readonly MediaKindOption[]
): Array<{ option: MediaKindOption; items: MediaItem[] }> {
  if (options.length === 0) return [];
  const known = new Set(options.map((option) => option.kind));
  const kindOf = (item: MediaItem) => (known.has(item.kind) ? item.kind : options[0].kind);
  return options
    .map((option) => ({ option, items: items.filter((item) => kindOf(item) === option.kind) }))
    .filter((group) => group.items.length > 0);
}

/** 改一张图的类型（右键「设为三视图 / 设为形象图」） */
export function setMediaKind(
  items: readonly MediaItem[],
  id: string,
  kind: MediaKind
): MediaItem[] {
  return items.map((item) => (item.id === id ? { ...item, kind } : item));
}

/** 生成视频用的人物参考图：三视图优先，其次主要形象图（最多 limit 张） */
export function characterReferencePaths(
  items: readonly MediaItem[] | undefined,
  cover: string | undefined,
  limit = 3
): string[] {
  const list = items ?? [];
  const turnarounds = list.filter((item) => item.kind === 'turnaround').map((item) => item.path);
  const main = resolveCover(list, cover);
  const paths = [...turnarounds, ...(main ? [main] : [])];
  return Array.from(new Set(paths)).slice(0, limit);
}

// ─── 人物设计 ───────────────────────────────────────────────────────────

export interface CharacterDesign {
  appearance: string;
  personality: string;
  background: string;
  speech: string;
  outfit: string;
  /** 扩展设定可省略，兼容旧人物卡。解析后统一补为空字符串。 */
  identity?: string;
  environment?: string;
  species?: string;
  health?: string;
  posture?: string;
  virtues?: string;
  lifestyle?: string;
  selfImage?: string;
  publicImage?: string;
  needs?: string;
  beliefs?: string;
  contradiction?: string;
  emotionalTriggers?: string;
  coping?: string;
  family?: string;
  education?: string;
  influences?: string;
  socialPosition?: string;

  habits?: string;
  preferences?: string;
  strengths?: string;
  weaknesses?: string;
  goal?: string;
  motivation?: string;
  fear?: string;
  secret?: string;
  values?: string;
  arc?: string;
  goldenFinger?: string;
  powerLimits?: string;
  cultivation?: string;
  techniques?: string;
  equipment?: string;
  resources?: string;
  plotHooks?: string;
}

export const CHARACTER_TRAIT_FIELD_KEYS: readonly (keyof CharacterDesign)[] = [
  'appearance',
  'outfit',
  'personality',
  'speech',
  'habits',
  'preferences',
  'weaknesses',
  'species',
  'health',
  'posture',
  'virtues',
  'lifestyle',
];

export const CHARACTER_CONTEXT_FIELD_KEYS: readonly (keyof CharacterDesign)[] = [
  'environment',
  'background',
  'family',
  'education',
  'influences',
  'socialPosition',
];

export const CHARACTER_DESIGN_GROUPS = [
  { id: 'basics', label: '基础与外在辨识' },
  { id: 'behavior', label: '性格与日常' },
  { id: 'psychology', label: '内心与行为逻辑' },
  { id: 'origins', label: '身世与成长环境' },
  { id: 'power', label: '金手指与力量体系' },
  { id: 'inner', label: '内在动机' },
  { id: 'growth', label: '关系与成长' },
] as const;

/** 参考人物档案的外在特征、经历和动机维度，每项给出可用于写作的具体示例。 */
export const CHARACTER_DESIGN_FIELDS: ReadonlyArray<{
  key: keyof CharacterDesign;
  group: (typeof CHARACTER_DESIGN_GROUPS)[number]['id'];
  label: string;
  placeholder: string;
  optional?: boolean;
}> = [
  {
    key: 'identity',
    group: 'basics',
    label: '身份职业',
    placeholder: '例：青石镇铁匠学徒，出身普通人家，替师父接零活维持生计',
  },
  {
    key: 'appearance',
    group: 'basics',
    label: '外貌',
    placeholder: '例：身高 175 厘米，清瘦，黑发束起，左眉有浅疤，常微微驼背',
  },
  {
    key: 'outfit',
    group: 'basics',
    label: '服装',
    placeholder: '例：洗旧的灰蓝短打，袖口磨白，腰间总挂着秦伯给的旧剑',
  },
  {
    key: 'personality',
    group: 'behavior',
    label: '性格',
    placeholder: '例：嘴硬心软，遇事先冲；对陌生人戒备，对熟人却很护短',
  },
  {
    key: 'speech',
    group: 'behavior',
    label: '说话方式',
    placeholder: '例：话少，爱用短句；被夸时说“没什么”，撒谎时会刻意解释很多',
  },
  {
    key: 'habits',
    group: 'behavior',
    label: '习惯动作',
    placeholder: '例：紧张时摸左臂旧伤，进门先看出口，睡前会检查剑是否在手边',
  },
  {
    key: 'preferences',
    group: 'behavior',
    label: '喜好厌恶',
    placeholder: '例：偏爱热汤面，喜欢收集旧地图，厌恶浪费粮食和被人居高临下地打量',
  },
  {
    key: 'strengths',
    group: 'behavior',
    label: '能力长处',
    placeholder: '例：擅长辨认金属和修理器物，记路很准，混乱中能迅速找到退路',
  },
  {
    key: 'weaknesses',
    group: 'behavior',
    label: '性格缺点',
    placeholder: '例：不肯求助，容易把善意当施舍；遇到父亲的消息就失去判断',
  },
  {
    key: 'goldenFinger',
    group: 'power',
    label: '金手指',
    placeholder:
      '来源：重生后觉醒的推演面板\n作用：消耗阅历推演功法，可保留上次推演结果\n成长：完成关键任务后解锁新的推演范围',
  },
  {
    key: 'powerLimits',
    group: 'power',
    label: '限制代价',
    placeholder:
      '触发：必须见过完整招式\n限制：每日只能推演一次，不能跨越两个大境界\n代价：消耗神识，失败后需要休养三日',
  },
  {
    key: 'cultivation',
    group: 'power',
    label: '境界路线',
    placeholder:
      '当前：炼气七层，实际战力接近九层\n路线：炼气 → 筑基 → 金丹，走剑修一脉\n瓶颈：缺少筑基灵物，突破需先修复经脉',
  },
  {
    key: 'techniques',
    group: 'power',
    label: '功法技能',
    placeholder:
      '主修：青木诀，恢复快但爆发不足\n招式：回风剑，擅长借力反击\n底牌：燃血秘术，短暂越阶，使用后气血亏损',
  },
  {
    key: 'equipment',
    group: 'power',
    label: '法宝装备',
    placeholder:
      '青石剑：师父所赠，可吸收雷息，剑身有未解封印\n储物戒：空间有限，不能存放活物\n随身物：三张遁行符、一枚传讯玉简',
  },
  {
    key: 'resources',
    group: 'power',
    label: '资源机缘',
    placeholder:
      '收入：替宗门修补法器，换取灵石和贡献\n缺口：筑基丹主药、修复经脉的药方\n机缘：三月后秘境开启，地图只掌握半张',
  },
  {
    key: 'environment',
    group: 'origins',
    label: '成长环境',
    placeholder:
      '家庭与阶层：普通匠户，收入不稳，但邻里相互照应\n地域与时代：海边小镇，风暴频繁，重视守信和互助\n教育与规训：由师父带大，手艺比读书更受重视；犯错后要亲手补救',
  },
  {
    key: 'background',
    group: 'origins',
    label: '成长经历',
    placeholder:
      '故事开始前的关键经历，以及它如何塑造人物。\n例：父亲出海未归，跟随秦伯在铁匠铺长大；曾因轻信商人失去积蓄，从此不轻易接受承诺。',
  },
  {
    key: 'goal',
    group: 'inner',
    label: '当前目标',
    placeholder: '例：在冬季封港前凑齐船费，找到父亲最后停靠的海岛',
  },
  {
    key: 'motivation',
    group: 'inner',
    label: '深层动机',
    placeholder: '例：表面要找回父亲，内心想确认自己没有被抛弃，值得被人留下',
  },
  {
    key: 'fear',
    group: 'inner',
    label: '恐惧软肋',
    placeholder: '例：最怕同伴不告而别；一听到“等我回来”就会追问具体日期',
  },
  {
    key: 'secret',
    group: 'inner',
    label: '隐藏秘密',
    placeholder: '例：藏着一封父亲的诀别信，对所有人都说从未收到消息',
  },
  {
    key: 'values',
    group: 'inner',
    label: '价值底线',
    placeholder: '例：欠债一定偿还，绝不拿无辜者换自己的安全；亲人涉险时会动摇',
  },
  {
    key: 'arc',
    group: 'growth',
    label: '成长变化',
    placeholder: '例：起初认为凡事只能靠自己；经历一次失败后，学会向同伴求助并承担责任',
  },
  {
    key: 'plotHooks',
    group: 'growth',
    label: '伏笔爽点',
    placeholder:
      '伏笔：旧剑封印与父亲失踪有关\n期待：宗门大比中公开被低估的实力\n兑现：用前期不起眼的修器手艺破解秘境机关',
  },
  {
    key: 'species',
    group: 'basics',
    label: '种族与寿命',
    placeholder: '例：人类，寿命与常人相同；若为异族，写明生理特征与年龄尺度',
    optional: true,
  },
  {
    key: 'health',
    group: 'basics',
    label: '身体状况',
    placeholder: '例：左膝旧伤，久站会痛；体力好但不耐寒。剧情中的伤势变化另记',
    optional: true,
  },
  {
    key: 'posture',
    group: 'basics',
    label: '体态神情',
    placeholder: '例：站立时重心偏右，听人说话先看手，笑时会下意识收敛',
    optional: true,
  },
  {
    key: 'virtues',
    group: 'behavior',
    label: '性格长处',
    placeholder: '例：守信、能忍耐，对弱者有耐心；坚持原则有时显得不近人情',
    optional: true,
  },
  {
    key: 'lifestyle',
    group: 'behavior',
    label: '生活方式',
    placeholder: '例：收入先留作应急，东西坏了总想修好；空闲时喜欢独自走远路',
    optional: true,
  },
  {
    key: 'selfImage',
    group: 'psychology',
    label: '自我认知',
    placeholder: '例：觉得自己只能靠手艺立足，不愿承认也渴望别人认可',
    optional: true,
  },
  {
    key: 'publicImage',
    group: 'psychology',
    label: '外在印象',
    placeholder: '例：别人觉得他冷漠可靠；熟悉的人知道他只是怕说错话',
    optional: true,
  },
  {
    key: 'needs',
    group: 'psychology',
    label: '核心需求',
    placeholder: '例：渴望稳定的归属，害怕成为可有可无的人；写长期需求，而非本章任务',
    optional: true,
  },
  {
    key: 'beliefs',
    group: 'psychology',
    label: '信念原则',
    placeholder: '例：承诺比身份重要，受过的帮助必须回报；这些信念源自什么',
    optional: true,
  },
  {
    key: 'contradiction',
    group: 'psychology',
    label: '内在矛盾',
    placeholder: '例：想被信任却从不解释，珍惜同伴却习惯替别人作决定',
    optional: true,
  },
  {
    key: 'emotionalTriggers',
    group: 'psychology',
    label: '情绪触发',
    placeholder: '例：被怀疑失信时会愤怒，被公开感谢时反而不知所措',
    optional: true,
  },
  {
    key: 'coping',
    group: 'psychology',
    label: '应对方式',
    placeholder: '例：受压时先沉默，把焦虑变成忙碌；难过时用冷笑话回避',
    optional: true,
  },
  {
    key: 'family',
    group: 'origins',
    label: '家庭与阶层',
    placeholder: '例：匠户出身，由师父抚养，收入不稳；亲属之间有何期待与责任',
    optional: true,
  },
  {
    key: 'education',
    group: 'origins',
    label: '教育与文化',
    placeholder: '例：识字不多但熟悉行会规矩；家乡重承诺、忌谈海难',
    optional: true,
  },
  {
    key: 'influences',
    group: 'origins',
    label: '重要影响',
    placeholder: '例：师父教他先承担再解释；一次受骗让他不再轻信好意',
    optional: true,
  },
  {
    key: 'socialPosition',
    group: 'origins',
    label: '社会位置',
    placeholder: '例：在镇上被视为可靠的学徒；到宗门后没有家族支持，话语权很低',
    optional: true,
  },
];

const DESIGN_FIELD_MAX = 800;

export function parseCharacterDesign(raw: unknown): Required<CharacterDesign> {
  const source = isRecord(raw) ? raw : {};
  const field = (key: keyof CharacterDesign) =>
    Array.from(str(source[key])).slice(0, DESIGN_FIELD_MAX).join('');
  return {
    appearance: field('appearance'),
    personality: field('personality'),
    background: field('background'),
    environment: field('environment'),
    species: field('species'),
    health: field('health'),
    posture: field('posture'),
    virtues: field('virtues'),
    lifestyle: field('lifestyle'),
    selfImage: field('selfImage'),
    publicImage: field('publicImage'),
    needs: field('needs'),
    beliefs: field('beliefs'),
    contradiction: field('contradiction'),
    emotionalTriggers: field('emotionalTriggers'),
    coping: field('coping'),
    family: field('family'),
    education: field('education'),
    influences: field('influences'),
    socialPosition: field('socialPosition'),

    speech: field('speech'),
    outfit: field('outfit'),
    identity: field('identity'),
    habits: field('habits'),
    preferences: field('preferences'),
    strengths: field('strengths'),
    weaknesses: field('weaknesses'),
    goal: field('goal'),
    motivation: field('motivation'),
    fear: field('fear'),
    secret: field('secret'),
    values: field('values'),
    arc: field('arc'),
    goldenFinger: field('goldenFinger'),
    powerLimits: field('powerLimits'),
    cultivation: field('cultivation'),
    techniques: field('techniques'),
    equipment: field('equipment'),
    resources: field('resources'),
    plotHooks: field('plotHooks'),
  };
}

export function isDesignEmpty(design: CharacterDesign): boolean {
  return CHARACTER_DESIGN_FIELDS.every(({ key }) => !design[key]?.trim());
}

/** 给 AI 的人物描述（出图、续写、分镜共用）：只带已填写的字段 */
export function describeCharacter(
  name: string,
  design: CharacterDesign,
  fallbackDescription = ''
): string {
  const parts = CHARACTER_DESIGN_FIELDS.filter(({ key }) => design[key]?.trim()).map(
    ({ key, label }) => `${label}：${design[key]?.trim()}`
  );
  if (parts.length === 0 && fallbackDescription.trim()) parts.push(fallbackDescription.trim());
  return parts.length ? `${name}（${parts.join('；')}）` : name;
}

/** 只与外形相关的字段（出图用；性格 / 背景 / 说话方式不进画面提示词） */
function visualDescription(design: CharacterDesign, fallbackDescription: string): string {
  const parts = [design.appearance, design.outfit].map((value) => value.trim()).filter(Boolean);
  if (parts.length === 0 && fallbackDescription.trim()) {
    parts.push(Array.from(fallbackDescription.trim()).slice(0, 200).join(''));
  }
  return parts.join('；');
}

const CHARACTER_KIND_PROMPTS: Partial<Record<MediaKind, string>> = {
  portrait: '人物半身立绘，正面略侧，干净的浅色背景，五官清晰',
  turnaround:
    '角色设定三视图（character turnaround sheet）：同一人物的正面、侧面、背面全身像并排，纯白背景，比例一致，服装与发型完全相同，不要文字',
  outfit: '全身立绘，展示服装与装备细节，纯色背景',
  expression: '同一人物的表情特写，喜、怒、哀、惊，四宫格，纯色背景',
  background: '人物置身于常出现的场景中，中景构图，环境氛围清晰',
};

const LORE_KIND_PROMPTS: Partial<Record<MediaKind, string>> = {
  concept: '概念设定图，完整展示主体样貌与结构',
  background: '场景气氛图，宽画幅，可作为影视镜头背景，画面中不出现人物',
  other: '细节特写，展示纹样、材质与工艺',
};

export interface CharacterImagePromptInput {
  name: string;
  design: CharacterDesign;
  description?: string;
  kind: MediaKind;
  style?: string;
  /** 作者补充的一句话（例如「雪夜，披着斗篷」） */
  extra?: string;
}

/** 人物出图提示词：画风 + 类型模板 + 外貌 / 服装 + 作者补充 */
export function buildCharacterImagePrompt(input: CharacterImagePromptInput): string {
  const lines = [
    input.style ? `${input.style}风格` : '',
    CHARACTER_KIND_PROMPTS[input.kind] ?? '人物插画',
    `人物：${input.name}`,
    visualDescription(input.design, input.description ?? ''),
    input.extra?.trim() ?? '',
  ].filter(Boolean);
  return lines.join('。').replace(/\u3002\u3002+/g, '。');
}

export interface LoreImagePromptInput {
  title: string;
  summary?: string;
  kind: MediaKind;
  style?: string;
  extra?: string;
}

export function buildLoreImagePrompt(input: LoreImagePromptInput): string {
  const summary = Array.from(input.summary?.trim() ?? '')
    .slice(0, 300)
    .join('');
  const lines = [
    input.style ? `${input.style}风格` : '',
    LORE_KIND_PROMPTS[input.kind] ?? '设定插画',
    `主题：${input.title}`,
    summary,
    input.extra?.trim() ?? '',
  ].filter(Boolean);
  return lines.join('。').replace(/\u3002\u3002+/g, '。');
}

// ─── 设定分类（多级目录）与标签 ─────────────────────────────────────────

export const LORE_FOLDER_DEPTH_MAX = 4;
const FOLDER_SEGMENT_MAX = 30;

/** 「地理 / 北境 /」→「地理/北境」：去空段与非法字符，最多 4 级 */
export function normalizeLoreFolder(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .split(/[\\/\uff0f]+/)
    .map((part) => {
      const cleaned = Array.from(part)
        .filter((char) => (char.codePointAt(0) ?? 0) >= 0x20)
        .join('')
        .trim();
      return Array.from(cleaned).slice(0, FOLDER_SEGMENT_MAX).join('');
    })
    .filter((part) => part && part !== '.' && part !== '..')
    .slice(0, LORE_FOLDER_DEPTH_MAX)
    .join('/');
}

/** 标签：去重、去空白、去掉开头的 #，最多 12 个 */
export function normalizeTags(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,\uff0c\u3001\s]+/)
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const tag = Array.from(value.replace(/^#+/, '').trim()).slice(0, 20).join('');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

export interface LoreFolderNode<T> {
  name: string;
  /** 完整路径（例如「地理/北境」） */
  path: string;
  folders: LoreFolderNode<T>[];
  items: T[];
  /** 本目录及子目录的条目总数 */
  total: number;
}

/** 按 folder 把条目组织成树（目录与条目按名称排序；没有分类的条目在根上） */
export function buildLoreFolderTree<T extends { folder: string }>(
  entries: readonly T[],
  sortKey: (entry: T) => string
): LoreFolderNode<T> {
  const root: LoreFolderNode<T> = { name: '', path: '', folders: [], items: [], total: 0 };
  for (const entry of entries) {
    const parts = normalizeLoreFolder(entry.folder).split('/').filter(Boolean);
    let node = root;
    node.total += 1;
    parts.forEach((part, index) => {
      let child = node.folders.find((folder) => folder.name === part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          folders: [],
          items: [],
          total: 0,
        };
        node.folders.push(child);
      }
      child.total += 1;
      node = child;
    });
    node.items.push(entry);
  }
  const sort = (node: LoreFolderNode<T>) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    node.items.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'zh-Hans-CN'));
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}
