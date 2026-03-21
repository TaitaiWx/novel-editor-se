import { extractOutline } from '@novel-editor/basic-algorithm';
import type { LoreCategory } from './types';
import type { LoreDraft } from './lore-data';

const CATEGORY_KEYWORDS: Array<{ category: LoreCategory; keywords: string[] }> = [
  { category: 'world', keywords: ['世界观', '世界', '地理', '历史', '背景', '设定'] },
  { category: 'faction', keywords: ['势力', '组织', '阵营', '门派', '宗门', '国家', '家族'] },
  { category: 'system', keywords: ['体系', '规则', '修炼', '能力', '等级', '技能', '机制'] },
  { category: 'term', keywords: ['术语', '名词', '称谓', '地点', '物品', '专有'] },
];

function inferCategory(text: string, fallback: LoreCategory): LoreCategory {
  const normalized = text.trim();
  for (const item of CATEGORY_KEYWORDS) {
    if (item.keywords.some((keyword) => normalized.includes(keyword))) {
      return item.category;
    }
  }
  return fallback;
}

function isPureCategoryHeading(text: string): boolean {
  return CATEGORY_KEYWORDS.some((item) => item.keywords.includes(text.trim()));
}

function parseJsonDrafts(raw: string, fallback: LoreCategory): LoreDraft[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (parsed as { entries?: unknown; items?: unknown; data?: unknown }).entries ||
          (parsed as { items?: unknown }).items ||
          (parsed as { data?: unknown }).data
        : null;

    if (!Array.isArray(rows)) {
      return null;
    }

    return rows
      .map((item) => {
        if (typeof item === 'string') {
          return { category: fallback, title: item.trim(), summary: '' } satisfies LoreDraft;
        }
        if (!item || typeof item !== 'object') {
          return null;
        }
        const row = item as {
          category?: string;
          title?: string;
          name?: string;
          summary?: string;
          content?: string;
          description?: string;
          tags?: unknown;
        };
        const title = row.title?.trim() || row.name?.trim() || '';
        if (!title) {
          return null;
        }
        return {
          category: inferCategory(row.category || title, fallback),
          title,
          summary: row.summary?.trim() || row.content?.trim() || row.description?.trim() || '',
          tags: Array.isArray(row.tags)
            ? row.tags.filter((tag): tag is string => typeof tag === 'string')
            : [],
        } satisfies LoreDraft;
      })
      .filter((item): item is LoreDraft => Boolean(item));
  } catch {
    return null;
  }
}

function fallbackTitle(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export function parseLoreDraftsFromImport(
  rawContent: string,
  fileName: string,
  fallbackCategory: LoreCategory
): LoreDraft[] {
  const jsonDrafts = parseJsonDrafts(rawContent, fallbackCategory);
  if (jsonDrafts && jsonDrafts.length > 0) {
    return jsonDrafts;
  }

  const content = rawContent.trim();
  if (!content) {
    return [];
  }

  const outline = extractOutline(content, { enableHeuristic: true });
  if (outline.length === 0) {
    return [
      {
        category: fallbackCategory,
        title: fallbackTitle(fileName),
        summary: content,
      },
    ];
  }

  const lines = content.split('\n');
  const categoryStack = new Map<number, LoreCategory>();
  const drafts: LoreDraft[] = [];

  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[index + 1];
    const currentCategory = inferCategory(current.text, fallbackCategory);
    categoryStack.set(current.level, currentCategory);
    for (const key of Array.from(categoryStack.keys())) {
      if (key > current.level) {
        categoryStack.delete(key);
      }
    }

    const start = current.line;
    const end = next ? next.line - 1 : lines.length;
    const sectionBody = lines.slice(start, end).join('\n').trim();
    const inheritedCategory =
      categoryStack.get(current.level - 1) || categoryStack.get(current.level) || fallbackCategory;

    if (!sectionBody && isPureCategoryHeading(current.text)) {
      continue;
    }

    drafts.push({
      category: isPureCategoryHeading(current.text) ? inheritedCategory : currentCategory,
      title: current.text.trim(),
      summary: sectionBody,
    });
  }

  return drafts.length > 0
    ? drafts
    : [
        {
          category: fallbackCategory,
          title: fallbackTitle(fileName),
          summary: content,
        },
      ];
}
