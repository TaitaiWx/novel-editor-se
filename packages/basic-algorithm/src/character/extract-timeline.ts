import { extractOutline } from '../outline/extract-outline';
import type { OutlineNode } from '../outline/types';

export interface CharacterTimelineEntry {
  key: string;
  title: string;
  summary: string;
  chapterLabel: string;
  chapterNumber?: number;
  mentionCount: number;
  startLine: number;
  endLine: number;
}

export interface ExtractCharacterTimelineOptions {
  maxEntries?: number;
  maxSummaryLength?: number;
  fallbackSegmentChars?: number;
  fallbackChapterLabel?: string;
}

interface TimelineSection {
  title: string;
  chapterLabel: string;
  chapterNumber?: number;
  body: string;
  startLine: number;
  endLine: number;
}

const SENTENCE_RE = /[^。！？!?；;\n]+[。！？!?；;]?/g;
const DEFAULT_MAX_SUMMARY_LENGTH = 120;
const DEFAULT_FALLBACK_SEGMENT_CHARS = 1200;
const DEFAULT_EVENT_TITLE_LENGTH = 30;
const RE_PRIMARY_CHAPTER = /^(第([一二三四五六七八九十百千万零〇两\d]+)([章节回集篇]))\s*(.*)$/;
const RE_CONTAINER_CHAPTER = /^(第([一二三四五六七八九十百千万零〇两\d]+)([幕卷部]))\s*(.*)$/;
const RE_NUMBERED_TITLE = /^(\d+(?:\.\d+)*)[.、)\s]\s*(.+)$/;

interface ParsedChapterMeta {
  label: string;
  chapterNumber?: number;
  remainder: string;
  kind: 'primary' | 'container' | 'numbered' | 'other';
}

function normalizeKeywords(keywords: string[]): string[] {
  const unique = Array.from(
    new Set(
      keywords
        .map((item) => item.trim())
        .filter(Boolean)
        .sort((left, right) => right.length - left.length)
    )
  );

  return unique.filter(
    (keyword, index) => !unique.slice(0, index).some((prev) => prev.includes(keyword))
  );
}

function normalizeComparableText(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[。！？!?；;，,、]/g, '')
    .trim();
}

function parseChineseInteger(raw: string): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);

  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const unitMap: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
    万: 10000,
  };

  let section = 0;
  let total = 0;
  let number = 0;

  for (const char of raw) {
    if (char in digitMap) {
      number = digitMap[char];
      continue;
    }

    const unit = unitMap[char];
    if (!unit) return undefined;

    if (unit === 10000) {
      section = (section + (number || 0)) * unit;
      total += section;
      section = 0;
      number = 0;
      continue;
    }

    section += (number || 1) * unit;
    number = 0;
  }

  const result = total + section + number;
  return result > 0 ? result : undefined;
}

function parseChapterMeta(rawTitle: string): ParsedChapterMeta {
  const title = rawTitle.trim();
  const primaryMatch = title.match(RE_PRIMARY_CHAPTER);
  if (primaryMatch) {
    return {
      label: primaryMatch[1].trim(),
      chapterNumber: parseChineseInteger(primaryMatch[2]),
      remainder: (primaryMatch[4] || '').trim(),
      kind: 'primary',
    };
  }

  const containerMatch = title.match(RE_CONTAINER_CHAPTER);
  if (containerMatch) {
    return {
      label: containerMatch[1].trim(),
      chapterNumber: parseChineseInteger(containerMatch[2]),
      remainder: (containerMatch[4] || '').trim(),
      kind: 'container',
    };
  }

  const numberedMatch = title.match(RE_NUMBERED_TITLE);
  if (numberedMatch) {
    const prefix = numberedMatch[1];
    return {
      label: prefix,
      chapterNumber: Number(prefix.split('.')[0]),
      remainder: numberedMatch[2].trim(),
      kind: 'numbered',
    };
  }

  return {
    label: title,
    remainder: '',
    kind: 'other',
  };
}

function countKeywordMentions(text: string, keywords: string[]): number {
  const haystack = text.toLowerCase();
  let count = 0;

  keywords.forEach((keyword) => {
    const needle = keyword.toLowerCase();
    let cursor = 0;
    while (cursor < haystack.length) {
      const nextIndex = haystack.indexOf(needle, cursor);
      if (nextIndex === -1) break;
      count += 1;
      cursor = nextIndex + needle.length;
    }
  });

  return count;
}

function clipSentence(sentence: string, maxSummaryLength: number): string {
  if (sentence.length <= maxSummaryLength) return sentence;
  const clipped = sentence.slice(0, maxSummaryLength);
  const lastSoftBoundary = Math.max(
    clipped.lastIndexOf('，'),
    clipped.lastIndexOf('、'),
    clipped.lastIndexOf('：'),
    clipped.lastIndexOf('；'),
    clipped.lastIndexOf(','),
    clipped.lastIndexOf(';')
  );
  if (lastSoftBoundary >= Math.floor(maxSummaryLength * 0.45)) {
    return `${clipped.slice(0, lastSoftBoundary + 1).trim()}…`;
  }
  return `${clipped.trim()}…`;
}

function trimSentenceEnding(text: string): string {
  return text.replace(/[。！？!?；;：:]+$/g, '').trim();
}

function buildEventTitle(
  sectionTitle: string,
  chapterLabel: string,
  summary: string,
  maxLength: number = DEFAULT_EVENT_TITLE_LENGTH
): string {
  const parsed = parseChapterMeta(sectionTitle);
  const headingRemainder = trimSentenceEnding(parsed.remainder);
  if (headingRemainder) {
    return clipSentence(headingRemainder, maxLength).replace(/…$/g, '');
  }

  const candidateSentence = trimSentenceEnding(
    (summary.match(SENTENCE_RE) || [summary])[0] || summary
  );
  if (candidateSentence) {
    return clipSentence(candidateSentence, maxLength).replace(/…$/g, '');
  }

  return chapterLabel;
}

function buildSectionSummary(body: string, keywords: string[], maxSummaryLength: number): string {
  const normalizedBody = body.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizedBody) return '';

  const sentences = (normalizedBody.match(SENTENCE_RE) || [normalizedBody])
    .map((item) => item.trim())
    .filter(Boolean);

  const relevantSentences = Array.from(
    new Set(sentences.filter((sentence) => keywords.some((keyword) => sentence.includes(keyword))))
  );

  if (relevantSentences.length === 0) {
    return clipSentence(normalizedBody, maxSummaryLength);
  }

  const selected: string[] = [];
  let currentLength = 0;
  for (const sentence of relevantSentences) {
    const nextLength = currentLength + sentence.length + (selected.length > 0 ? 1 : 0);
    if (selected.length > 0 && nextLength > maxSummaryLength) break;
    selected.push(sentence);
    currentLength = nextLength;
  }

  const summary = selected.join(' ').trim();
  if (!summary) return clipSentence(relevantSentences[0], maxSummaryLength);
  if (summary.length <= maxSummaryLength) return summary;
  return clipSentence(summary, maxSummaryLength);
}

function selectTimelineAnchors(outline: OutlineNode[]): OutlineNode[] {
  const normalized = outline.filter((item) => item.text.trim() && item.source !== 'heuristic');
  if (normalized.length === 0) return [];

  const primaryCandidates = normalized.filter((item) => {
    const parsed = parseChapterMeta(item.text);
    return parsed.kind === 'primary' || parsed.kind === 'numbered';
  });
  const candidates = primaryCandidates.length > 0 ? primaryCandidates : normalized;

  const levelCounts = new Map<number, number>();
  candidates.forEach((item) => {
    levelCounts.set(item.level, (levelCounts.get(item.level) || 0) + 1);
  });

  const dominantLevel = Array.from(levelCounts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0] - right[0];
  })[0]?.[0];

  if (dominantLevel === undefined) return [];
  return candidates.filter((item) => item.level === dominantLevel);
}

function buildOutlineSections(content: string): TimelineSection[] {
  const lines = content.split(/\r?\n/);
  const anchors = selectTimelineAnchors(extractOutline(content));
  if (anchors.length === 0) return [];

  return anchors.map((anchor, index) => {
    const parsed = parseChapterMeta(anchor.text);
    const nextLine = anchors[index + 1]?.line || lines.length + 1;
    const body = lines
      .slice(anchor.line, Math.max(anchor.line, nextLine - 1))
      .join('\n')
      .trim();
    return {
      title: anchor.text.trim() || `片段 ${index + 1}`,
      chapterLabel: parsed.label || `片段 ${index + 1}`,
      chapterNumber: parsed.chapterNumber,
      body,
      startLine: anchor.line,
      endLine: Math.max(anchor.line, nextLine - 1),
    };
  });
}

function buildFallbackSections(
  content: string,
  fallbackSegmentChars: number,
  fallbackChapterLabel?: string
): TimelineSection[] {
  if (fallbackChapterLabel) {
    const lineCount = content.split(/\r?\n/).length;
    const parsed = parseChapterMeta(fallbackChapterLabel);
    return [
      {
        title: fallbackChapterLabel,
        chapterLabel: parsed.label || fallbackChapterLabel,
        chapterNumber: parsed.chapterNumber,
        body: content.trim(),
        startLine: 1,
        endLine: lineCount,
      },
    ].filter((item) => item.body);
  }

  const paragraphs = content
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const sections: TimelineSection[] = [];
  let currentParts: string[] = [];
  let currentLength = 0;
  let startLine = 1;
  let consumedParagraphs = 0;

  const flush = () => {
    if (currentParts.length === 0) return;
    const body = currentParts.join('\n\n').trim();
    const paragraphCount = currentParts.length;
    sections.push({
      title: `正文片段 ${sections.length + 1}`,
      chapterLabel: `正文片段 ${sections.length + 1}`,
      body,
      startLine,
      endLine: startLine + paragraphCount - 1,
    });
    consumedParagraphs += paragraphCount;
    startLine = consumedParagraphs + 1;
    currentParts = [];
    currentLength = 0;
  };

  paragraphs.forEach((paragraph) => {
    const nextLength = currentLength + paragraph.length + (currentParts.length > 0 ? 2 : 0);
    if (currentParts.length > 0 && nextLength > fallbackSegmentChars) {
      flush();
    }
    currentParts.push(paragraph);
    currentLength += paragraph.length + (currentParts.length > 1 ? 2 : 0);
  });
  flush();

  return sections;
}

function limitEntries(
  entries: CharacterTimelineEntry[],
  maxEntries?: number
): CharacterTimelineEntry[] {
  if (!maxEntries || entries.length <= maxEntries) return entries;
  if (maxEntries <= 2) return entries.slice(0, maxEntries);

  const headCount = Math.ceil(maxEntries / 2);
  const tailCount = maxEntries - headCount;
  return [...entries.slice(0, headCount), ...entries.slice(entries.length - tailCount)];
}

/**
 * 从正文中为指定人物提取按出现顺序排列的经历时间线。
 * 这是纯规则、零依赖、线性复杂度的算法，避免 AI 摘要的重复、截断和阶段误判。
 */
export function extractCharacterTimeline(
  content: string,
  keywords: string[],
  options: ExtractCharacterTimelineOptions = {}
): CharacterTimelineEntry[] {
  const normalizedContent = content.trim();
  const normalizedKeywords = normalizeKeywords(keywords);
  if (!normalizedContent || normalizedKeywords.length === 0) return [];

  const maxSummaryLength = options.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH;
  const fallbackSegmentChars = options.fallbackSegmentChars ?? DEFAULT_FALLBACK_SEGMENT_CHARS;
  const sections = buildOutlineSections(normalizedContent);
  const timelineSections =
    sections.length > 0
      ? sections
      : buildFallbackSections(
          normalizedContent,
          fallbackSegmentChars,
          options.fallbackChapterLabel
        );
  const seenSummaryKeys = new Set<string>();

  const entries = timelineSections
    .map((section, index) => {
      const mentionCount = countKeywordMentions(section.body, normalizedKeywords);
      if (mentionCount === 0) return null;
      const summary = buildSectionSummary(section.body, normalizedKeywords, maxSummaryLength);
      if (!summary) return null;

      const summaryKey = normalizeComparableText(summary);
      if (!summaryKey || seenSummaryKeys.has(summaryKey)) return null;
      seenSummaryKeys.add(summaryKey);

      const chapterLabel = section.chapterLabel || section.title || `正文片段 ${index + 1}`;
      const eventTitle = buildEventTitle(section.title, chapterLabel, summary);

      return {
        key: `${section.startLine}-${section.endLine}-${index}`,
        title: eventTitle,
        summary,
        chapterLabel,
        chapterNumber: section.chapterNumber,
        mentionCount,
        startLine: section.startLine,
        endLine: section.endLine,
      } satisfies CharacterTimelineEntry;
    })
    .filter((item): item is CharacterTimelineEntry => Boolean(item));

  return limitEntries(entries, options.maxEntries);
}
