/**
 * AI 生成结果解析、作用域产物解析等纯函数
 */
import type {
  AIGenerationScope,
  AssistantScopedCharacter,
  AssistantScopedLore,
  AssistantScopedMaterial,
  GeneratedLoreDraft,
  GeneratedMaterialDraft,
} from './types';
import { extractJsonBlock } from '@/render/components/RightPanel/utils';

export function getAIGenerationScopeLabel(scope: AIGenerationScope): string {
  switch (scope) {
    case 'current-content':
      return '当前内容';
    case 'current-chapter':
      return '当前章节';
    case 'whole-project':
      return '整部作品';
    default:
      return '当前内容';
  }
}

export function parseLoreGenerationResult(raw: string): GeneratedLoreDraft[] {
  const json = extractJsonBlock(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      entries?: Array<{
        category?: string;
        title?: string;
        summary?: string;
        tags?: string[];
      }>;
    };
    return (parsed.entries || [])
      .map(
        (item): GeneratedLoreDraft => ({
          category:
            item.category === 'world' ||
            item.category === 'faction' ||
            item.category === 'system' ||
            item.category === 'term'
              ? item.category
              : 'world',
          title: item.title?.trim() || '',
          summary: item.summary?.trim() || '',
          tags: Array.isArray(item.tags)
            ? item.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .map((tag) => tag.trim())
            : [],
        })
      )
      .filter((item) => item.title);
  } catch {
    return [];
  }
}

export function parseMaterialGenerationResult(raw: string): GeneratedMaterialDraft[] {
  const json = extractJsonBlock(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      materials?: Array<{
        title?: string;
        summary?: string;
        kind?: string;
        relatedChapter?: string;
        keywords?: string[];
      }>;
    };
    return (parsed.materials || [])
      .map(
        (item): GeneratedMaterialDraft => ({
          title: item.title?.trim() || '',
          summary: item.summary?.trim() || '',
          kind:
            item.kind === 'scene' ||
            item.kind === 'character' ||
            item.kind === 'setting' ||
            item.kind === 'research'
              ? item.kind
              : 'reference',
          relatedChapter: item.relatedChapter?.trim() || '',
          keywords: Array.isArray(item.keywords)
            ? item.keywords
                .filter((keyword): keyword is string => typeof keyword === 'string')
                .map((keyword) => keyword.trim())
                .filter(Boolean)
            : [],
        })
      )
      .filter((item) => item.title && item.summary);
  } catch {
    return [];
  }
}

export function selectChunksForAiAnalysis(chunks: string[], maxChunks = 12): string[] {
  if (chunks.length <= maxChunks) return chunks;

  // 采用“全局均匀采样 + 尾部保留”的策略，避免只取前几段导致最新内容漏检。
  const tailCount = Math.min(4, maxChunks);
  const headCount = Math.max(0, maxChunks - tailCount);
  const headEndExclusive = Math.max(0, chunks.length - tailCount);
  const selectedIndexes = new Set<number>();

  if (headCount > 0 && headEndExclusive > 0) {
    if (headCount === 1) {
      selectedIndexes.add(0);
    } else {
      for (let index = 0; index < headCount; index += 1) {
        const ratio = index / (headCount - 1);
        const sampledIndex = Math.floor(ratio * (headEndExclusive - 1));
        selectedIndexes.add(sampledIndex);
      }
    }
  }

  for (let index = headEndExclusive; index < chunks.length; index += 1) {
    selectedIndexes.add(index);
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .slice(0, maxChunks)
    .map((index) => chunks[index]);
}

/** 将任意值安全转换为去空白字符串；非字符串一律视为空，避免对非字符串调用 trim 抛错 */
function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 解析 JSON 数组，并只保留对象类型的元素，非法 JSON 或非数组返回空数组 */
function parseJsonObjectArray(raw: string | null): Array<Record<string, unknown>> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
    );
  } catch {
    return [];
  }
}

const SCOPED_LORE_CATEGORIES: ReadonlyArray<AssistantScopedLore['category']> = [
  'world',
  'faction',
  'system',
  'term',
];

const SCOPED_MATERIAL_KINDS: ReadonlyArray<AssistantScopedMaterial['kind']> = [
  'scene',
  'character',
  'setting',
  'research',
  'reference',
];

export function parseAssistantScopedCharacters(raw: string | null): AssistantScopedCharacter[] {
  // 逐项容错：单个条目字段类型异常时只跳过/置空该字段，不影响整个列表
  const result: AssistantScopedCharacter[] = [];
  for (const item of parseJsonObjectArray(raw)) {
    const name = toTrimmedString(item.name);
    if (!name) continue;
    result.push({
      name,
      role: toTrimmedString(item.role),
      description: toTrimmedString(item.description),
    });
  }
  return result;
}

export function parseAssistantScopedLore(raw: string | null): AssistantScopedLore[] {
  const result: AssistantScopedLore[] = [];
  for (const item of parseJsonObjectArray(raw)) {
    const title = toTrimmedString(item.title);
    if (!title) continue;
    const category = SCOPED_LORE_CATEGORIES.find((value) => value === item.category) ?? 'world';
    result.push({ category, title, summary: toTrimmedString(item.summary) });
  }
  return result;
}

export function parseAssistantScopedMaterials(raw: string | null): AssistantScopedMaterial[] {
  const result: AssistantScopedMaterial[] = [];
  for (const item of parseJsonObjectArray(raw)) {
    const title = toTrimmedString(item.title);
    if (!title) continue;
    const kind = SCOPED_MATERIAL_KINDS.find((value) => value === item.kind) ?? 'reference';
    result.push({
      title,
      summary: toTrimmedString(item.summary),
      kind,
      relatedChapter: toTrimmedString(item.relatedChapter),
    });
  }
  return result;
}

export function formatMaterialUsageLabel(chapterNames: string[]): string {
  const unique = Array.from(new Set(chapterNames.filter(Boolean)));
  if (unique.length === 0) return '';
  if (unique.length <= 2) {
    return `用于 ${unique.join('、')}`;
  }
  return `用于 ${unique.slice(0, 2).join('、')} 等 ${unique.length} 章`;
}
