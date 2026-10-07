/**
 * 场景视频的纯逻辑（无 DOM / IPC）：
 * - 场景正文提取：选区 / 光标所在的「第X场」段落 / 按场景名定位 / 整章兜底
 * - 出场人物识别、地点推荐
 * - 没有配置 AI 时的确定性分镜拆分（按段落 / 句子分组）
 */
import { STORYBOARD_MAX_SHOTS, type Shot, type ShotSize } from '@novel-editor/video';

const RE_SCENE =
  /^(\u7b2c[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+\u573a)\s*(.*)$/;
const RE_ACT =
  /^\u7b2c[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+\u5e55/;
const RE_HEADING = /^#{1,6}\s/;

/** 场景正文上限（交给分镜提示词前还会按 token 再截断） */
export const MAX_SCENE_SOURCE_CHARS = 6000;

export interface SceneBlock {
  /** 「第一场 清晨的青石镇」 */
  title: string;
  /** 标记行之后到下一个场 / 幕 / 标题之前的正文（已去掉首尾空行） */
  text: string;
  /** 标记行（1-based） */
  startLine: number;
  /** 最后一行（1-based，含） */
  endLine: number;
}

/**
 * 结构行识别器（作者在「设置 → 正文结构」配置的规则，见 utils/structureRules）；
 * 省略时只认内置的「第X场 / 第X幕」
 */
export type SceneLineClassifier = (line: string) => 'chapter' | 'act' | 'scene' | null;

/** 一行的场景标题；不是场景标记时为 null */
function sceneTitleOf(trimmed: string, classify?: SceneLineClassifier): string | null {
  if (classify) return classify(trimmed) === 'scene' ? trimmed : null;
  const match = RE_SCENE.exec(trimmed);
  return match ? `${match[1]} ${match[2] ?? ''}`.trim() : null;
}

function isBoundary(line: string, classify?: SceneLineClassifier): boolean {
  const trimmed = line.trim();
  if (RE_HEADING.test(trimmed)) return true;
  if (classify) return classify(trimmed) !== null;
  return RE_SCENE.test(trimmed) || RE_ACT.test(trimmed);
}

/** 列出正文中所有「第X场」段落 */
export function listSceneBlocks(text: string, classify?: SceneLineClassifier): SceneBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: SceneBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const title = sceneTitleOf(lines[index].trim(), classify);
    if (title === null) continue;
    let end = index + 1;
    while (end < lines.length && !isBoundary(lines[end], classify)) end += 1;
    const body = lines
      .slice(index + 1, end)
      .join('\n')
      .trim();
    blocks.push({
      title,
      text: body,
      startLine: index + 1,
      endLine: end,
    });
    index = end - 1;
  }
  return blocks;
}

/** 光标所在行属于哪一场（行号 1-based）；不在任何场内时返回 null */
export function findSceneBlockAtLine(
  text: string,
  line: number,
  classify?: SceneLineClassifier
): SceneBlock | null {
  return (
    listSceneBlocks(text, classify).find(
      (block) => line >= block.startLine && line <= block.endLine
    ) ?? null
  );
}

/** 按场景名定位：完全一致优先，其次只比较「第X场」前缀（作者改了场景小标题时仍能找到） */
export function findSceneBlockByTitle(
  text: string,
  title: string,
  classify?: SceneLineClassifier
): SceneBlock | null {
  const wanted = title.replace(/\s+/g, ' ').trim();
  if (!wanted) return null;
  const blocks = listSceneBlocks(text, classify);
  const exact = blocks.find((block) => block.title === wanted);
  if (exact) return exact;
  const prefix = RE_SCENE.exec(wanted)?.[1];
  return prefix ? (blocks.find((block) => block.title.startsWith(prefix)) ?? null) : null;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** 去掉章节标题、幕 / 场标记行，留下可读正文 */
export function stripStructureLines(text: string, classify?: SceneLineClassifier): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !isBoundary(line, classify))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type SceneSourceOrigin = 'selection' | 'scene-block' | 'chapter';

export interface SceneSourceInput {
  /** 整章正文 */
  docText: string;
  /** 编辑器选中的文字 */
  selectionText?: string;
  /** 选区起点所在行（1-based），用于给选段起名 */
  selectionLine?: number;
  /** 光标所在行（1-based） */
  cursorLine?: number;
  /** 指定场景名（卷纲 / 重新打开标签） */
  sceneTitle?: string;
  /** 结构行识别器（项目的正文结构规则）；省略时只认「第X场 / 第X幕」 */
  classify?: SceneLineClassifier;
}

export interface SceneSource {
  /** 场景名：用于标签、落盘目录（资料/视频/<章>/<场景>） */
  scene: string;
  text: string;
  origin: SceneSourceOrigin;
}

/** 选段的场景名：所在「第X场」的标题，否则「选段-<前 10 个字>」 */
export function selectionSceneName(selection: string, enclosing: SceneBlock | null): string {
  if (enclosing) return enclosing.title;
  const head = clip(
    selection.replace(
      /[\s\u201c\u201d"'\u2018\u2019\u300c\u300d\u300e\u300f\uff0c\u3002\uff01\uff1f\u3001\uff1a\uff1b\u2026\u2014\-#/\\]+/g,
      ''
    ),
    10
  );
  return head ? `选段-${head}` : '选段';
}

/**
 * 解析场景来源（优先级：选区 > 指定场景名 > 光标所在的场 > 整章）
 * 整章兜底时场景名为「全章」
 */
export function resolveSceneSource(input: SceneSourceInput): SceneSource {
  const docText = input.docText ?? '';
  const { classify } = input;
  const selection = input.selectionText?.trim() ?? '';
  if (selection) {
    const enclosing =
      input.selectionLine !== undefined
        ? findSceneBlockAtLine(docText, input.selectionLine, classify)
        : null;
    return {
      scene: selectionSceneName(selection, enclosing),
      text: clip(selection, MAX_SCENE_SOURCE_CHARS),
      origin: 'selection',
    };
  }
  const byTitle = input.sceneTitle
    ? findSceneBlockByTitle(docText, input.sceneTitle, classify)
    : null;
  const block =
    byTitle ??
    (input.cursorLine !== undefined
      ? findSceneBlockAtLine(docText, input.cursorLine, classify)
      : null);
  if (block) {
    return {
      scene: input.sceneTitle?.trim() || block.title,
      text: clip(block.text, MAX_SCENE_SOURCE_CHARS),
      origin: 'scene-block',
    };
  }
  return {
    scene: input.sceneTitle?.trim() || '全章',
    text: clip(stripStructureLines(docText, classify), MAX_SCENE_SOURCE_CHARS),
    origin: 'chapter',
  };
}

export interface NamedCharacter {
  name: string;
  aliases?: string[];
}

/** 正文中出现的人物（名字或别名），按首次出现的位置排序 */
export function detectCharacters(text: string, characters: readonly NamedCharacter[]): string[] {
  const found: Array<{ name: string; index: number }> = [];
  for (const character of characters) {
    const name = character.name.trim();
    if (!name) continue;
    const positions = [name, ...(character.aliases ?? [])]
      .map((alias) => alias.trim())
      .filter(Boolean)
      .map((alias) => text.indexOf(alias))
      .filter((index) => index >= 0);
    if (positions.length) found.push({ name, index: Math.min(...positions) });
  }
  return Array.from(new Set(found.sort((a, b) => a.index - b.index).map((item) => item.name)));
}

/** 推荐地点：正文中出现过的第一个设定条目标题（没有则为空） */
export function suggestLocation(text: string, titles: readonly string[]): string {
  let best: { title: string; index: number } | null = null;
  for (const raw of titles) {
    const title = raw.trim();
    if (title.length < 2) continue;
    const index = text.indexOf(title);
    if (index >= 0 && (!best || index < best.index)) best = { title, index };
  }
  return best?.title ?? '';
}

// ─── 确定性分镜（没有配置 AI 时） ─────────────────────────────────────────

const SENTENCE_RE =
  /[^\u3002\uff01\uff1f!?\u2026]+(?:[\u3002\uff01\uff1f!?\u2026]+[\u201d"\u300f\u300d]?)?/g;

/** 按句末标点切句（引号跟随句末标点） */
export function splitSentences(paragraph: string): string[] {
  return (paragraph.match(SENTENCE_RE) ?? []).map((item) => item.trim()).filter(Boolean);
}

/** 把 items 均匀分成 groups 组（保持顺序，前面的组多一个） */
export function groupEvenly<T>(items: readonly T[], groups: number): T[][] {
  const count = Math.max(1, Math.min(groups, items.length));
  const base = Math.floor(items.length / count);
  const extra = items.length % count;
  const result: T[][] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    result.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return result.filter((group) => group.length > 0);
}

export interface FallbackStoryboardOptions {
  minShots?: number;
  maxShots?: number;
  durationSec?: number;
  characters?: readonly NamedCharacter[];
  location?: string;
}

const DESCRIPTION_MAX = 160;

function firstQuote(text: string): string | undefined {
  const match = /[\u201c"\u300c]([^\u201d"\u300d]{1,80})[\u201d"\u300d]/.exec(text);
  return match?.[1]?.trim() || undefined;
}

function shotSizeFor(index: number, total: number, hasDialogue: boolean): ShotSize {
  if (index === 0) return '全景';
  if (hasDialogue) return '近景';
  if (index === total - 1) return '中景';
  return index % 2 === 0 ? '中景' : '特写';
}

function cameraFor(index: number, total: number, hasDialogue: boolean): string {
  if (index === 0) return '缓慢推近';
  if (hasDialogue) return '固定机位，正反打';
  if (index === total - 1) return '缓慢拉远';
  return '平移跟随';
}

/**
 * 没有配置 AI 时的分镜：段落数足够时按段落分组，否则按句子分组，得到 min–max 个镜头。
 * 结果完全由正文决定（同样的输入得到同样的分镜），镜头 id 为 shot-1…shot-N。
 */
export function splitSceneIntoShots(
  sceneText: string,
  options: FallbackStoryboardOptions = {}
): Shot[] {
  const minShots = Math.max(1, options.minShots ?? 3);
  const maxShots = Math.min(STORYBOARD_MAX_SHOTS, Math.max(minShots, options.maxShots ?? 6));
  const durationSec = options.durationSec ?? 6;
  const paragraphs = stripStructureLines(sceneText)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  let units: string[] = paragraphs;
  if (paragraphs.length < minShots) {
    const sentences = paragraphs.flatMap((paragraph) => splitSentences(paragraph));
    if (sentences.length > paragraphs.length) units = sentences;
  }
  const groups = groupEvenly(units, Math.min(maxShots, units.length));

  return groups.map((group, index): Shot => {
    const text = group.join('');
    const dialogue = firstQuote(text);
    const description = clip(text.replace(/\s+/g, ' '), DESCRIPTION_MAX);
    const shot: Shot = {
      id: `shot-${index + 1}`,
      shotSize: shotSizeFor(index, groups.length, Boolean(dialogue)),
      durationSec,
      description,
      camera: cameraFor(index, groups.length, Boolean(dialogue)),
    };
    const people = detectCharacters(text, options.characters ?? []);
    if (people.length) shot.characters = people;
    if (options.location) shot.location = options.location;
    if (dialogue) shot.dialogue = dialogue;
    return shot;
  });
}
