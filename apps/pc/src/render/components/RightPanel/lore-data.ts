import {
  normalizeLoreFolder,
  parseMediaItems,
  type MediaItem,
} from '@novel-editor/core/entity-media';
import type { LoreCategory, LoreEntry } from './types';
import { normalizeEntityGroup } from './utils/character-attributes';

export interface LoreAuditSection {
  key: 'missing' | 'conflict' | 'template' | 'other';
  title: string;
  body: string;
  items: string[];
}

interface LoreRow {
  id: number;
  category: string;
  title: string;
  content: string;
  tags: string;
  attributes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoreDraft {
  category: LoreCategory;
  title: string;
  summary: string;
  tags?: string[];
  /** 分类目录（例如「地理/北境」） */
  folder?: string;
  /** 自定义分组名（空字符串清除） */
  group?: string;
  cover?: string;
  media?: MediaItem[];
}

export interface LoreAttributes {
  folder: string;
  group?: string;
  cover?: string;
  media: MediaItem[];
}

/** 设定扩展字段（world_settings.attributes JSON）：分类目录、封面、图集 */
export function parseLoreAttributes(raw: string | null | undefined): LoreAttributes {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }
  const cover = typeof parsed.cover === 'string' && parsed.cover.trim() ? parsed.cover.trim() : '';
  const group = normalizeEntityGroup(parsed.group);
  return {
    folder: normalizeLoreFolder(parsed.folder),
    ...(group ? { group } : {}),
    ...(cover ? { cover } : {}),
    media: parseMediaItems(parsed.media),
  };
}

export function stringifyLoreAttributes(attributes: Partial<LoreAttributes>): string {
  const folder = normalizeLoreFolder(attributes.folder);
  const media = parseMediaItems(attributes.media);
  const group = normalizeEntityGroup(attributes.group);
  return JSON.stringify({
    ...(folder ? { folder } : {}),
    ...(group ? { group } : {}),
    ...(attributes.cover ? { cover: attributes.cover } : {}),
    ...(media.length ? { media } : {}),
  });
}

const LORE_AUDIT_CATEGORY_KEYWORDS: Array<{ category: LoreCategory; keywords: string[] }> = [
  { category: 'world', keywords: ['世界观', '世界', '地理', '历史', '背景', '设定', '时代'] },
  { category: 'faction', keywords: ['势力', '组织', '阵营', '门派', '宗门', '国家', '家族'] },
  { category: 'system', keywords: ['体系', '规则', '修炼', '能力', '等级', '技能', '机制'] },
  { category: 'term', keywords: ['术语', '名词', '称谓', '地点', '物品', '专有', '概念'] },
];

function normalizeCategory(category: string): LoreCategory {
  if (
    category === 'world' ||
    category === 'faction' ||
    category === 'system' ||
    category === 'term'
  ) {
    return category;
  }
  return 'world';
}

export function mapLoreRow(row: LoreRow): LoreEntry {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags || '[]');
    if (Array.isArray(parsed)) {
      tags = parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    category: normalizeCategory(row.category),
    title: row.title || '',
    summary: row.content || '',
    tags,
    ...parseLoreAttributes(row.attributes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadLoreEntriesByFolder(folderPath: string | null): Promise<LoreEntry[]> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc || !folderPath) {
    return [];
  }

  const rows = (await ipc.invoke('db-world-setting-list-by-folder', folderPath)) as
    | LoreRow[]
    | null
    | undefined;
  // 数据库未就绪等情况下可能返回空值，按无设定处理
  return (rows ?? []).map(mapLoreRow);
}

export function buildLoreDedupKey(entry: Pick<LoreDraft, 'category' | 'title'>): string {
  return `${entry.category}::${entry.title.trim().toLowerCase()}`;
}

function normalizeLoreAuditItem(line: string): string {
  return line
    .replace(/^(?:[-*\u2022])\s*/, '')
    .replace(/^\d+[.\u3001)\uff09]\s*/, '')
    .trim();
}

function inferLoreAuditCategory(text: string, fallback: LoreCategory): LoreCategory {
  const normalized = text.trim();
  for (const item of LORE_AUDIT_CATEGORY_KEYWORDS) {
    if (item.keywords.some((keyword) => normalized.includes(keyword))) {
      return item.category;
    }
  }
  return fallback;
}

function getLoreAuditSectionMeta(line: string): Pick<LoreAuditSection, 'key' | 'title'> | null {
  const normalized = line.trim().replace(/^\d+[.\u3001)\uff09]\s*/, '');
  if (normalized.startsWith('缺失设定')) {
    return { key: 'missing', title: '缺失设定' };
  }
  if (normalized.startsWith('可能冲突')) {
    return { key: 'conflict', title: '可能冲突' };
  }
  if (normalized.startsWith('建议补充的条目模板') || normalized.startsWith('建议补充条目模板')) {
    return { key: 'template', title: '建议补充的条目模板' };
  }
  return null;
}

export function parseLoreAuditSections(raw: string): LoreAuditSection[] {
  const normalized = raw.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const sections: Array<Omit<LoreAuditSection, 'body' | 'items'> & { lines: string[] }> = [];
  let currentSection: (Omit<LoreAuditSection, 'body' | 'items'> & { lines: string[] }) | null =
    null;

  const pushCurrent = () => {
    if (!currentSection) return;
    sections.push(currentSection);
    currentSection = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      if (currentSection) {
        currentSection.lines.push('');
      }
      return;
    }

    const sectionMeta = getLoreAuditSectionMeta(line.replace(/[\uff1a:]/g, ''));
    if (sectionMeta) {
      pushCurrent();
      currentSection = { ...sectionMeta, lines: [] };
      return;
    }

    if (!currentSection) {
      currentSection = { key: 'other', title: '诊断结果', lines: [] };
    }
    currentSection.lines.push(line);
  });

  pushCurrent();

  return sections
    .map((section) => {
      const body = section.lines.join('\n').trim();
      return {
        key: section.key,
        title: section.title,
        body,
        items: body
          .split('\n')
          .map((item) => normalizeLoreAuditItem(item))
          .filter(Boolean),
      } as LoreAuditSection;
    })
    .filter((section) => section.body || section.items.length > 0);
}

export function parseLoreDraftFromAuditItem(
  item: string,
  fallbackCategory: LoreCategory
): LoreDraft | null {
  const normalized = normalizeLoreAuditItem(item);
  if (!normalized) return null;

  const segments = normalized
    .split(/[\uff1a:]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) return null;

  const title = segments[0].slice(0, 40).trim();
  if (!title) return null;

  const summary = (segments.slice(1).join('：') || normalized).trim();
  return {
    category: inferLoreAuditCategory(normalized, fallbackCategory),
    title,
    summary,
  };
}
