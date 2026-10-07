/**
 * 节奏：按正文信号估算每章张力，输出卷内相对的 1-5 级曲线
 * 纯启发式：冲突类词汇、感叹 / 问句、短句密度与大纲里的转折词，不调用 AI
 */
import type { ChapterTension, VolumeChapterSource } from './types';

/** 冲突 / 危机类词汇（命中次数计入张力） */
const CONFLICT_WORDS = [
  '杀',
  '血',
  '战',
  '斗',
  '怒',
  '吼',
  '嚎',
  '咬',
  '刺',
  '砍',
  '逃',
  '追',
  '死',
  '伤',
  '痛',
  '危险',
  '危机',
  '攻击',
  '扑',
  '撕',
  '惊',
  '恐惧',
  '绝望',
  '爆',
  '崩',
  '燃',
  '敌',
  '围',
];

/** 大纲 / 场景标题里的转折词，权重更高 */
const TURN_WORDS = ['转折', '高潮', '危机', '对决', '抉择', '真相', '背叛', '决战', '反转', '之夜'];

const RE_SENTENCE = /[^。！？!?…\n]+[。！？!?…]*/g;

function countOccurrences(text: string, word: string): number {
  if (!word) return 0;
  let count = 0;
  let index = text.indexOf(word);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(word, index + word.length);
  }
  return count;
}

interface RawTension {
  score: number;
  conflict: number;
  exclaim: number;
  shortRatio: number;
  turns: number;
}

function rawTension(source: VolumeChapterSource): RawTension {
  const text = source.content;
  const length = text.replace(/\s/g, '').length;
  if (length === 0) return { score: 0, conflict: 0, exclaim: 0, shortRatio: 0, turns: 0 };
  const perK = 1000 / Math.max(length, 200);
  const conflict = CONFLICT_WORDS.reduce((sum, word) => sum + countOccurrences(text, word), 0);
  const exclaim = (text.match(/[！!]/g) || []).length + (text.match(/[？?]/g) || []).length * 0.5;
  const sentences = (text.match(RE_SENTENCE) || []).map((item) => item.trim()).filter(Boolean);
  const short = sentences.filter((item) => item.replace(/\s/g, '').length <= 12).length;
  const shortRatio = sentences.length > 0 ? short / sentences.length : 0;
  const headline = [source.title, ...(source.outline || [])].join(' ');
  const turns = TURN_WORDS.reduce((sum, word) => sum + countOccurrences(headline, word), 0);
  const score = conflict * perK * 1.2 + exclaim * perK * 0.8 + shortRatio * 6 + turns * 3;
  return { score, conflict, exclaim: Math.round(exclaim), shortRatio, turns };
}

/**
 * 计算每章张力：原始分按卷内最小 / 最大值线性映射到 1-5（全部相同时为 3）
 */
export function computeChapterTension(chapters: VolumeChapterSource[]): ChapterTension[] {
  const raws = chapters.map(rawTension);
  const scores = raws.map((item) => item.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return chapters.map((chapter, index) => {
    const raw = raws[index];
    const level =
      chapter.content.trim().length === 0
        ? 1
        : max - min < 0.01
          ? 3
          : Math.round(1 + ((raw.score - min) / (max - min)) * 4);
    const signals: string[] = [];
    if (raw.conflict > 0) signals.push(`冲突词 ${raw.conflict}`);
    if (raw.exclaim > 0) signals.push(`感叹 / 问句 ${raw.exclaim}`);
    if (raw.shortRatio >= 0.3) signals.push(`短句 ${Math.round(raw.shortRatio * 100)}%`);
    if (raw.turns > 0) signals.push('标题含转折');
    return {
      path: chapter.path,
      title: chapter.title,
      level,
      score: Math.round(raw.score * 10) / 10,
      signals,
    };
  });
}

/** 节奏提示：连续平缓、缺少高点、结尾回落等（基于张力曲线） */
export function describeTensionCurve(tension: ChapterTension[]): string[] {
  if (tension.length < 2) return [];
  const notes: string[] = [];
  let flatRun = 1;
  let longestFlat = 1;
  for (let i = 1; i < tension.length; i += 1) {
    flatRun = tension[i].level === tension[i - 1].level ? flatRun + 1 : 1;
    longestFlat = Math.max(longestFlat, flatRun);
  }
  if (longestFlat >= 3) notes.push(`有连续 ${longestFlat} 章张力持平，可考虑加入变化`);
  const peakIndex = tension.reduce(
    (best, item, index) => (item.level > tension[best].level ? index : best),
    0
  );
  if (tension.length >= 3 && peakIndex === 0) {
    notes.push('张力最高点在卷首，后续可能显得平淡');
  } else if (peakIndex >= Math.floor(tension.length * 0.6)) {
    notes.push(`高点在「${tension[peakIndex].title}」，整体呈上升趋势`);
  }
  const last = tension[tension.length - 1];
  if (tension.length >= 3 && last.level <= 2) notes.push('卷末张力较低，可以留一个钩子');
  return notes;
}
