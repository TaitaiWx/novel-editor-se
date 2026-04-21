import { extractOutline } from '../outline/extract-outline';
import type { OutlineNode } from '../outline/types';

export interface CharacterTimelineEntry {
  key: string;
  title: string;
  summary: string;
  mentionCount: number;
  startLine: number;
  endLine: number;
}

export interface ExtractCharacterTimelineOptions {
  maxEntries?: number;
  maxSummaryLength?: number;
  fallbackSegmentChars?: number;
}

interface TimelineSection {
  title: string;
  body: string;
  startLine: number;
  endLine: number;
}

const SENTENCE_RE = /[^。！？!?；;\n]+[。！？!?；;]?/g;
const DEFAULT_MAX_SUMMARY_LENGTH = 120;
const DEFAULT_FALLBACK_SEGMENT_CHARS = 1200;

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
  const normalized = outline.filter((item) => item.text.trim());
  if (normalized.length < 2) return [];

  const preferred = normalized.filter((item) => item.source !== 'heuristic');
  if (preferred.length < 2) return [];

  const candidates = preferred;
  const minLevel = Math.min(...candidates.map((item) => item.level));
  const topLevel = candidates.filter((item) => item.level === minLevel);
  return topLevel.length >= 2 ? topLevel : candidates;
}

function buildOutlineSections(content: string): TimelineSection[] {
  const lines = content.split(/\r?\n/);
  const anchors = selectTimelineAnchors(extractOutline(content));
  if (anchors.length === 0) return [];

  return anchors.map((anchor, index) => {
    const nextLine = anchors[index + 1]?.line || lines.length + 1;
    const body = lines
      .slice(anchor.line, Math.max(anchor.line, nextLine - 1))
      .join('\n')
      .trim();
    return {
      title: anchor.text.trim() || `片段 ${index + 1}`,
      body,
      startLine: anchor.line,
      endLine: Math.max(anchor.line, nextLine - 1),
    };
  });
}

function buildFallbackSections(content: string, fallbackSegmentChars: number): TimelineSection[] {
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
    sections.length > 0 ? sections : buildFallbackSections(normalizedContent, fallbackSegmentChars);
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

      return {
        key: `${section.startLine}-${section.endLine}-${index}`,
        title: section.title,
        summary,
        mentionCount,
        startLine: section.startLine,
        endLine: section.endLine,
      } satisfies CharacterTimelineEntry;
    })
    .filter((item): item is CharacterTimelineEntry => Boolean(item));

  return limitEntries(entries, options.maxEntries);
}
