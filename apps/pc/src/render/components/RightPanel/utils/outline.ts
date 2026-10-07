import type { OutlineNode } from '@novel-editor/basic-algorithm';
import type { OutlineEntry } from '../types';
import { buildOutlineCacheKeyFromTitle } from './hash';
import { extractJsonBlock } from './text';

export function extractLineSummary(lines: string[], startLine: number, endLine: number): string {
  const body = lines
    .slice(Math.max(0, startLine - 1), Math.max(0, endLine - 1))
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[#*`>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return '暂无内容摘要';
  return body.length > 110 ? `${body.slice(0, 110)}...` : body;
}

export function extractChapterContent(
  content: string,
  entries: OutlineEntry[],
  entryIndex: number,
  maxChars: number
): string {
  if (entryIndex < 0 || entryIndex >= entries.length) return '';
  const lines = content.split(/\r?\n/);
  const entry = entries[entryIndex];
  const nextLine = entries[entryIndex + 1]?.line || lines.length + 1;
  const body = lines
    .slice(entry.line, nextLine - 1)
    .join('\n')
    .trim();
  return body.length > maxChars ? body.slice(0, maxChars) : body;
}

export function isGenericOutlineTitle(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (
    /^\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+[\u7ae0\u5e55\u8282\u5377\u90e8\u56de\u7bc7\u96c6]$/.test(
      trimmed
    )
  )
    return true;
  if (/^(chapter|part|act|scene)\s*\d+$/i.test(trimmed)) return true;
  return false;
}

export function isChapterHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    /^\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+[\u7ae0\u5e55\u8282\u5377\u90e8\u56de\u7bc7\u96c6](?:[\uff1a:\uff1a\s-].+)?$/.test(
      trimmed
    )
  )
    return true;
  if (/^(chapter|part|act)\s*\d+(?:\s*[:\uff1a-]\s*.+)?$/i.test(trimmed)) return true;
  return false;
}

export function selectChapterHeadings(headings: OutlineNode[]): OutlineNode[] {
  if (headings.length === 0) return [];

  const normalized = headings.filter((item) => item.text.trim());
  if (normalized.length === 0) return [];

  const chapterCandidates = normalized.filter((item) => isChapterHeading(item.text));
  if (chapterCandidates.length >= 2) return chapterCandidates;

  const minLevel = Math.min(...normalized.map((item) => item.level || 1));
  const topLevel = normalized.filter((item) => (item.level || 1) === minLevel);
  return topLevel.length > 0 ? topLevel : normalized;
}

export function parseOutlineTitleCompletions(raw: string): Array<{ line: number; title: string }> {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) {
    return raw
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/line\s*[:=]\s*(\d+)\s*[,\uff0c;\uff1b\s]+title\s*[:=]\s*(.+)$/i);
        if (!match) return null;
        return {
          line: Number(match[1]) || 0,
          title: (match[2] || '').replace(/^['"""]|['"""]$/g, '').trim(),
        };
      })
      .filter((item): item is { line: number; title: string } => Boolean(item?.line && item.title));
  }

  try {
    const parsed = JSON.parse(jsonBlock) as
      | Array<{ line?: number; title?: string }>
      | {
          items?: Array<{ line?: number; title?: string }>;
          titles?: Array<{ line?: number; title?: string }>;
          result?: Array<{ line?: number; title?: string }>;
          [line: string]: unknown;
        };

    const entries: Array<{ line?: number; title?: string }> = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray(parsed.titles)
          ? parsed.titles
          : Array.isArray(parsed.result)
            ? parsed.result
            : Object.entries(parsed)
                .map(([key, value]) => {
                  const maybeLine = Number(key);
                  if (!Number.isFinite(maybeLine)) return null;
                  if (typeof value === 'string') return { line: maybeLine, title: value };
                  if (value && typeof value === 'object') {
                    const item = value as { title?: string };
                    return { line: maybeLine, title: item.title || '' };
                  }
                  return null;
                })
                .filter((item): item is { line: number; title: string } => Boolean(item));

    return entries
      .map((item) => ({
        line: Number(item.line) || 0,
        title: (item.title || '').trim(),
      }))
      .filter((item) => item.line > 0 && item.title);
  } catch {
    return [];
  }
}

export function buildOutlineEntries(content: string, headings: OutlineNode[]): OutlineEntry[] {
  const lines = content.split(/\r?\n/);
  if (!content.trim()) return [];

  const chapterHeadings = selectChapterHeadings(headings);

  if (chapterHeadings.length === 0) {
    const bodyText = lines.join('\n').trim();
    return [
      {
        cacheKey: buildOutlineCacheKeyFromTitle('未命名章节'),
        line: 1,
        level: 1,
        text: '未命名章节',
        originalText: '',
        summary: extractLineSummary(lines, 1, lines.length + 1),
        autoGenerated: false,
        needsAiTitle: true,
        wordCount: bodyText.replace(/\s+/g, '').length,
      },
    ];
  }

  return chapterHeadings.map((heading, index) => {
    const nextLine = chapterHeadings[index + 1]?.line || lines.length + 1;
    const normalizedText = heading.text.trim();
    const chapterBody = lines
      .slice(heading.line, nextLine - 1)
      .join('\n')
      .trim();
    return {
      cacheKey: buildOutlineCacheKeyFromTitle(normalizedText || '未命名章节'),
      line: heading.line,
      level: 1,
      text: normalizedText || '未命名章节',
      originalText: normalizedText,
      summary: extractLineSummary(lines, heading.line + 1, nextLine),
      autoGenerated: false,
      needsAiTitle: isGenericOutlineTitle(normalizedText),
      wordCount: chapterBody.replace(/\s+/g, '').length,
    };
  });
}
