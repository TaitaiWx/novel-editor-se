/**
 * 零输入推导卷纲：章节标题 + 正文里的「第X幕 / 第X场」标记 + 小标题 + 已有章纲 → 幕 → 章 → 关键节拍
 */
import { isDirectiveLine, sceneContainerTitle } from '../outline/novel-markers';
import {
  STRUCTURE_TEMPLATES,
  allocateChapters,
  getStructureLabel,
  pickStructureByChapterCount,
} from './structures';
import type {
  VolumeActPlan,
  VolumeBeat,
  VolumeChapterPlan,
  VolumeChapterSource,
  VolumeOutline,
  VolumeStructureId,
} from './types';

// 中文数字（一二三……万、零〇两）或阿拉伯数字
const NUM =
  '[\\u4e00\\u4e8c\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e\\u5343\\u4e07\\u96f6\\u3007\\u4e24\\d]+';
const RE_ACT = new RegExp(`^(\\u7b2c${NUM}\\u5e55)\\s*(.*)$`);
const RE_SCENE = new RegExp(`^(\\u7b2c${NUM}\\u573a)\\s*(.*)$`);
const RE_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const RE_CHAPTER_HEADING = new RegExp(`^\\u7b2c${NUM}[\\u7ae0\\u8282\\u56de\\u5377]`);
const BEAT_TEXT_MAX = 48;

/** 作者对推导结果的覆盖层（全部可选） */
export interface VolumePlanOverlay {
  /** 节拍 key → 作者改写后的内容 */
  beatEdits?: Record<string, string>;
  /** 章节路径 → 节拍 key 顺序（拖拽排序） */
  beatOrder?: Record<string, string[]>;
  /** 章节路径 → 生成的建议节拍 */
  suggestions?: Record<string, string[]>;
  /** 幕 key → 本段说明（生成或作者改写） */
  actNotes?: Record<string, string>;
}

export interface DeriveVolumeOptions {
  /** 指定结构；省略时有幕标记按标记分幕，否则按章数自动挑选模板 */
  structure?: VolumeStructureId | null;
}

function fileBase(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** 取一行的首句并截断，用作节拍内容 */
export function firstSentence(line: string, max = BEAT_TEXT_MAX): string {
  const trimmed = line.trim().replace(/^[>*\-\s]+/, '');
  const match = trimmed.match(/^.+?[\u3002\uff01\uff1f!?\u2026]+[\u201d\u300d\u300f"]?/);
  const sentence = (match ? match[0] : trimmed).trim();
  return sentence.length > max ? `${sentence.slice(0, max)}…` : sentence;
}

function isStructuralLine(line: string): boolean {
  return RE_ACT.test(line) || RE_SCENE.test(line) || RE_HEADING.test(line) || isDirectiveLine(line);
}

interface ChapterSegment {
  /** 本段开头的幕标记（null 表示延续上一幕） */
  act: { title: string; line: number } | null;
  beats: VolumeBeat[];
}

function uniqueKey(base: string, used: Set<string>): string {
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}~${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

/** 没有场景标记时的兜底节拍：已有章纲 → 小标题 → 开篇句 */
function fallbackBeats(
  source: VolumeChapterSource,
  lines: string[],
  used: Set<string>
): VolumeBeat[] {
  const base = fileBase(source.path);
  const outline = (source.outline || []).map((item) => item.trim()).filter(Boolean);
  if (outline.length > 0) {
    return outline.map((title) => ({
      key: uniqueKey(`${base}#outline:${title}`, used),
      title: '',
      text: title,
      source: 'outline' as const,
    }));
  }
  const headings: VolumeBeat[] = [];
  lines.forEach((raw, index) => {
    const match = raw.trim().match(RE_HEADING);
    if (!match || match[1].length < 2) return;
    const title = match[2].trim();
    if (!title || RE_CHAPTER_HEADING.test(title)) return;
    headings.push({
      key: uniqueKey(`${base}#heading:${title}`, used),
      title: '',
      text: title,
      source: 'heading',
      line: index + 1,
    });
  });
  if (headings.length > 0) return headings;
  const openingIndex = lines.findIndex((raw) => {
    const trimmed = raw.trim();
    return trimmed && !isStructuralLine(trimmed);
  });
  if (openingIndex < 0) return [];
  return [
    {
      key: uniqueKey(`${base}#opening`, used),
      title: '',
      text: firstSentence(lines[openingIndex]),
      source: 'opening',
      line: openingIndex + 1,
    },
  ];
}

/** 解析一章：按幕标记切段，段内收集场景节拍 */
function parseChapter(source: VolumeChapterSource): ChapterSegment[] {
  const lines = source.content.split(/\r?\n/);
  const base = fileBase(source.path);
  const used = new Set<string>();
  const segments: ChapterSegment[] = [{ act: null, beats: [] }];
  let pendingScene: VolumeBeat | null = null;
  let sceneCount = 0;

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const actMatch = trimmed.match(RE_ACT);
    if (actMatch) {
      pendingScene = null;
      segments.push({
        act: { title: `${actMatch[1]} ${actMatch[2] || ''}`.trim(), line: index + 1 },
        beats: [],
      });
      return;
    }
    // 场景：「第X场」标题，或小说格式的场景容器 :::scene{title=…}
    const sceneMatch = trimmed.match(RE_SCENE);
    const containerTitle = sceneMatch ? null : sceneContainerTitle(trimmed);
    if (sceneMatch || containerTitle !== null) {
      const title = sceneMatch
        ? `${sceneMatch[1]} ${sceneMatch[2] || ''}`.trim()
        : (containerTitle ?? '场景');
      const beat: VolumeBeat = {
        key: uniqueKey(`${base}#scene:${title}`, used),
        title,
        text: '',
        source: 'scene',
        line: index + 1,
      };
      segments[segments.length - 1].beats.push(beat);
      pendingScene = beat;
      sceneCount += 1;
      return;
    }
    if (pendingScene && !pendingScene.text && !isStructuralLine(trimmed)) {
      pendingScene.text = firstSentence(trimmed);
      pendingScene = null;
    }
  });

  if (sceneCount === 0) {
    segments[0].beats = fallbackBeats(source, lines, used);
  }
  // 幕标记之前的空白开头不单独占位
  if (segments.length > 1 && segments[0].beats.length === 0) segments.shift();
  return segments;
}

function chapterPlan(
  source: VolumeChapterSource,
  index: number,
  beats: VolumeBeat[],
  continued: boolean
): VolumeChapterPlan {
  return { path: source.path, title: source.title, index, continued, beats };
}

function buildMarkerActs(
  chapters: VolumeChapterSource[],
  parsed: ChapterSegment[][]
): VolumeActPlan[] {
  const acts: VolumeActPlan[] = [];
  let current: VolumeActPlan | null = null;
  chapters.forEach((source, index) => {
    parsed[index].forEach((segment, segmentIndex) => {
      if (segment.act) {
        current = {
          key: `markers:${acts.length}:${segment.act.title}`,
          title: segment.act.title,
          hint: '',
          line: segment.act.line,
          chapters: [],
        };
        acts.push(current);
      } else if (!current) {
        current = { key: 'markers:0:开篇', title: '开篇', hint: '', chapters: [] };
        acts.push(current);
      }
      current.chapters.push(chapterPlan(source, index, segment.beats, segmentIndex > 0));
    });
  });
  return acts;
}

function buildTemplateActs(
  structure: Exclude<VolumeStructureId, 'markers'>,
  chapters: VolumeChapterSource[],
  parsed: ChapterSegment[][]
): VolumeActPlan[] {
  const template = STRUCTURE_TEMPLATES[structure];
  const sizes = allocateChapters(
    chapters.length,
    template.stages.map((stage) => stage.weight)
  );
  const acts: VolumeActPlan[] = [];
  let cursor = 0;
  template.stages.forEach((stage, stageIndex) => {
    const size = sizes[stageIndex];
    // 没有章节时（空卷）仍保留各段，作为写作提示
    if (size === 0 && chapters.length > 0) return;
    const slice = chapters.slice(cursor, cursor + size);
    acts.push({
      key: `${structure}:${stageIndex}:${stage.title}`,
      title: stage.title,
      hint: stage.hint,
      chapters: slice.map((source, offset) =>
        chapterPlan(
          source,
          cursor + offset,
          parsed[cursor + offset].flatMap((segment) => segment.beats),
          false
        )
      ),
    });
    cursor += size;
  });
  return acts;
}

/** 正文里是否有幕标记 */
export function hasActMarkers(chapters: VolumeChapterSource[]): boolean {
  return chapters.some((chapter) =>
    chapter.content.split(/\r?\n/).some((line) => RE_ACT.test(line.trim()))
  );
}

/**
 * 推导卷纲：有幕标记时默认按标记分幕，否则按章数自动选结构模板（三幕式 / 起承转合 / 英雄之旅）
 */
export function deriveVolumeOutline(
  chapters: VolumeChapterSource[],
  options: DeriveVolumeOptions = {}
): VolumeOutline {
  const markers = hasActMarkers(chapters);
  let structure: VolumeStructureId =
    options.structure ?? (markers ? 'markers' : pickStructureByChapterCount(chapters.length));
  if (structure === 'markers' && !markers) structure = pickStructureByChapterCount(chapters.length);
  const parsed = chapters.map(parseChapter);
  const acts =
    structure === 'markers'
      ? buildMarkerActs(chapters, parsed)
      : buildTemplateActs(structure, chapters, parsed);
  return {
    structure,
    structureLabel: getStructureLabel(structure),
    hasMarkers: markers,
    acts,
    chapterCount: chapters.length,
  };
}

function orderBeats(beats: VolumeBeat[], order: string[] | undefined): VolumeBeat[] {
  if (!order || order.length === 0) return beats;
  const rank = new Map(order.map((key, index) => [key, index]));
  return beats
    .map((beat, index) => ({ beat, index }))
    .sort((a, b) => {
      const ra = rank.get(a.beat.key);
      const rb = rank.get(b.beat.key);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.index - b.index;
    })
    .map((item) => item.beat);
}

/**
 * 把作者的覆盖层（就地改写、拖拽排序、生成的建议、幕说明）叠加到推导结果上
 * 返回新对象，不修改入参
 */
export function applyVolumePlanOverlay(
  outline: VolumeOutline,
  overlay: VolumePlanOverlay
): VolumeOutline {
  const edits = overlay.beatEdits || {};
  const suggestions = overlay.suggestions || {};
  // 建议节拍放在该章最后一次出现的位置
  const lastSegment = new Map<string, VolumeChapterPlan>();
  outline.acts.forEach((act) =>
    act.chapters.forEach((chapter) => lastSegment.set(chapter.path, chapter))
  );

  const acts = outline.acts.map((act) => {
    const note = overlay.actNotes?.[act.key];
    return {
      ...act,
      hint: note?.trim() ? note : act.hint,
      chapters: act.chapters.map((chapter) => {
        const base = fileBase(chapter.path);
        const extra: VolumeBeat[] =
          lastSegment.get(chapter.path) === chapter
            ? (suggestions[chapter.path] || [])
                .map((text) => text.trim())
                .filter(Boolean)
                .filter((text) => !chapter.beats.some((beat) => beat.text === text))
                .map((text, index) => ({
                  key: `${base}#suggestion:${index}`,
                  title: '',
                  text,
                  source: 'suggestion' as const,
                }))
            : [];
        const beats = [...chapter.beats, ...extra].map((beat) => {
          const edited = edits[beat.key];
          return edited !== undefined && edited.trim() ? { ...beat, text: edited.trim() } : beat;
        });
        return { ...chapter, beats: orderBeats(beats, overlay.beatOrder?.[chapter.path]) };
      }),
    };
  });
  return { ...outline, acts };
}
