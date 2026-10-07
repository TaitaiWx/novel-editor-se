/**
 * 伏笔：在正文与章纲里找「埋下的东西」（约定、秘密、来历不明的物件……），
 * 再看后文是否出现同一片段，粗略判断是否已呼应。纯启发式，只作提醒。
 */
import { firstSentence } from './derive';
import type { ForeshadowItem, VolumeChapterSource } from './types';

/** 伏笔触发词：作者显式标注优先，其次是常见的「埋线」说法 */
const SETUP_KEYWORDS = [
  '伏笔',
  '约定',
  '承诺',
  '发誓',
  '秘密',
  '真相',
  '来历',
  '下落',
  '总有一天',
  '等我回来',
  '一定要回来',
  '谜',
  '碎片',
  '预言',
];

const RE_SENTENCES = /[^。！？!?\n]+[。！？!?]*[”」』"]?/g;
const RE_CJK_RUN = /[一-鿿]{3,}/g;
/** 太常见、不能用来判断呼应的片段 */
const COMMON_GRAMS = new Set(['他说道', '她说道', '一下子', '这个时候', '没有人']);

function grams(text: string, size: number, exclude: string): string[] {
  const result = new Set<string>();
  (text.match(RE_CJK_RUN) || []).forEach((run) => {
    for (let i = 0; i + size <= run.length; i += 1) {
      const gram = run.slice(i, i + size);
      if (gram !== exclude && !COMMON_GRAMS.has(gram)) result.add(gram);
    }
  });
  return [...result];
}

/**
 * 找出可能的伏笔，最多 limit 条；同一章同一关键词只取第一处
 */
export function findForeshadowing(chapters: VolumeChapterSource[], limit = 30): ForeshadowItem[] {
  const items: ForeshadowItem[] = [];
  /** 已收录伏笔的片段：后文再次出现时视为呼应，不再作为新的伏笔 */
  const knownProbes = new Set<string>();
  chapters.forEach((chapter, chapterIndex) => {
    const usedKeywords = new Set<string>();
    const lines = chapter.content.split(/\r?\n/);
    const candidates: Array<{ text: string; line: number }> = [];
    lines.forEach((raw, index) => {
      (raw.match(RE_SENTENCES) || []).forEach((sentence) => {
        if (sentence.trim()) candidates.push({ text: sentence.trim(), line: index + 1 });
      });
    });
    (chapter.outline || []).forEach((title) => candidates.push({ text: title, line: 0 }));

    candidates.forEach((candidate) => {
      const keyword = SETUP_KEYWORDS.find((word) => candidate.text.includes(word));
      if (!keyword || usedKeywords.has(keyword)) return;
      // 后文呼应：后续章节出现本句中（除关键词本身外）的 4 字片段
      const probes = grams(candidate.text, 4, keyword);
      if (probes.some((gram) => knownProbes.has(gram))) return;
      usedKeywords.add(keyword);
      probes.forEach((gram) => knownProbes.add(gram));
      const echo = chapters
        .slice(chapterIndex + 1)
        .find((later) => probes.some((gram) => later.content.includes(gram)));
      items.push({
        key: `${chapter.path}#${candidate.line}:${keyword}`,
        chapterPath: chapter.path,
        chapterTitle: chapter.title,
        line: candidate.line,
        text: firstSentence(candidate.text, 60),
        keyword,
        echoed: Boolean(echo),
        echoedIn: echo?.title,
      });
    });
  });
  // 未呼应的排在前面
  return items.sort((a, b) => Number(a.echoed) - Number(b.echoed)).slice(0, limit);
}
