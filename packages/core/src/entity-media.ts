/**
 * 人物 / 设定的「设计 + 图集」模型（纯函数，GUI 渲染进程、主进程与 CLI 共用）
 *
 * - 图集：一组图片（形象图、三视图、服装、表情、背景、概念图…），其中一张选为封面（人物的「形象图」）；
 *   封面在人物详情显示为竖版大图，在列表 / 悬停卡片 / 场景视频等引用处裁成小圆头像
 * - 图片文件保存在 `<作品>/资料/图集/人物|设定/<名称>/`，AI 生成的图片旁边有同名 `.prompt.json`，可复现
 * - 人物设计（外貌、性格、背景、说话方式、服装）保存在人物卡 attributes.design；
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
}

export const CHARACTER_DESIGN_FIELDS: ReadonlyArray<{
  key: keyof CharacterDesign;
  label: string;
  placeholder: string;
}> = [
  {
    key: 'appearance',
    label: '外貌',
    placeholder: '例：十七岁，清瘦，黑发束起，左眉有一道浅疤，眼神倔强',
  },
  { key: 'outfit', label: '服装', placeholder: '例：洗旧的灰蓝短打，腰间挂着秦伯给的旧剑' },
  {
    key: 'personality',
    label: '性格',
    placeholder: '例：嘴硬心软，遇事先冲，答应的事一定做到',
  },
  { key: 'background', label: '背景', placeholder: '例：铁匠铺长大的孤儿，父亲追着星图出海未归' },
  { key: 'speech', label: '说话方式', placeholder: '例：话少，爱用短句，紧张时会挠头' },
];

const DESIGN_FIELD_MAX = 800;

export function parseCharacterDesign(raw: unknown): CharacterDesign {
  const source = isRecord(raw) ? raw : {};
  const field = (key: keyof CharacterDesign) =>
    Array.from(str(source[key])).slice(0, DESIGN_FIELD_MAX).join('');
  return {
    appearance: field('appearance'),
    personality: field('personality'),
    background: field('background'),
    speech: field('speech'),
    outfit: field('outfit'),
  };
}

export function isDesignEmpty(design: CharacterDesign): boolean {
  return CHARACTER_DESIGN_FIELDS.every(({ key }) => !design[key].trim());
}

/** 给 AI 的人物描述（出图、续写、分镜共用）：只带已填写的字段 */
export function describeCharacter(
  name: string,
  design: CharacterDesign,
  fallbackDescription = ''
): string {
  const parts = CHARACTER_DESIGN_FIELDS.filter(({ key }) => design[key].trim()).map(
    ({ key, label }) => `${label}：${design[key].trim()}`
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
