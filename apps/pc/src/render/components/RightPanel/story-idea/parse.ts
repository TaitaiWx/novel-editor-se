import type { PersistedOutlineNodeInput, StoryIdeaOutputRow } from '@/render/types/electron-api';
import { extractJsonBlock } from '../utils';
import type { StoryIdeaCardDraft } from './types';
import { normalizeIdeaTags, normalizeIdeaTermPool, normalizeIdeaTerms } from './normalize';
import { cleanText } from './text';

interface StoryIdeaSeedResponse {
  title?: string;
  premise?: string;
  tags?: string[];
  themeTerms?: string[];
  conflictTerms?: string[];
  twistTerms?: string[];
  note?: string;
}

interface StoryIdeaOutlineDirectionResponse {
  title?: string;
  summary?: string;
  beats?: string[];
  outlineTree?: PersistedOutlineNodeInput[];
}

interface StoryIdeaOutputsResponse {
  loglines?: Array<{ content?: string; reason?: string }>;
  sceneHooks?: Array<{ content?: string; focus?: string }>;
  outlineDirections?: StoryIdeaOutlineDirectionResponse[];
}

interface StoryIdeaRelatedTermsResponse {
  terms?: string[];
}

export function parseStoryIdeaSeedResponse(raw: string): Partial<StoryIdeaCardDraft> | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;

  try {
    const parsed = JSON.parse(jsonBlock) as StoryIdeaSeedResponse;
    // 只返回 AI 实际给出的字段：缺失字段不能以显式 undefined 出现，
    // 否则调用方 `{ ...draft, ...parsed }` 合并时会把草稿里的已有值覆盖掉
    const result: Partial<StoryIdeaCardDraft> = {};
    const title = cleanText(parsed.title, 32);
    if (title) result.title = title;
    const premise = cleanText(parsed.premise, 80);
    if (premise) result.premise = premise;
    if (parsed.tags) result.tags = normalizeIdeaTags(parsed.tags);
    if (parsed.themeTerms) result.themeTerms = normalizeIdeaTerms(parsed.themeTerms);
    if (parsed.conflictTerms) result.conflictTerms = normalizeIdeaTerms(parsed.conflictTerms);
    if (parsed.twistTerms) result.twistTerms = normalizeIdeaTerms(parsed.twistTerms);
    const note = cleanText(parsed.note, 200);
    if (note) result.note = note;
    return result;
  } catch {
    return null;
  }
}

export function parseStoryIdeaRelatedTermsResponse(raw: string): string[] | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;
  try {
    const parsed = JSON.parse(jsonBlock) as StoryIdeaRelatedTermsResponse;
    return normalizeIdeaTermPool(parsed.terms || []);
  } catch {
    return null;
  }
}

function sanitizeOutlineTree(
  nodes: PersistedOutlineNodeInput[] | undefined,
  depth = 1
): PersistedOutlineNodeInput[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node, index) => ({
      title: cleanText(node.title, 32) || `节点 ${index + 1}`,
      content: cleanText(node.content, 80),
      children: depth >= 3 ? [] : sanitizeOutlineTree(node.children, depth + 1),
      sortOrder: index,
    }))
    .filter((node) => node.title);
}

/** 过滤空项之后再标记首项为选中，避免首个原始项为空时没有任何选中项 */
function markFirstSelected<T extends { isSelected: boolean }>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, isSelected: index === 0 }));
}

export function parseStoryIdeaOutputsResponse(raw: string): {
  loglines: Array<{ content: string; metaJson: string; isSelected: boolean }>;
  sceneHooks: Array<{ content: string; metaJson: string; isSelected: boolean }>;
  outlineDirections: Array<{ content: string; metaJson: string; isSelected: boolean }>;
} | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;

  try {
    const parsed = JSON.parse(jsonBlock) as StoryIdeaOutputsResponse;
    const loglines = (parsed.loglines || [])
      .map((item) => {
        const content = cleanText(item.content, 120);
        if (!content) return null;
        return {
          content,
          metaJson: JSON.stringify({ reason: cleanText(item.reason, 80) }),
          isSelected: false,
        };
      })
      .filter((item): item is { content: string; metaJson: string; isSelected: boolean } => !!item);

    const sceneHooks = (parsed.sceneHooks || [])
      .map((item) => {
        const content = cleanText(item.content, 160);
        if (!content) return null;
        return {
          content,
          metaJson: JSON.stringify({ focus: cleanText(item.focus, 80) }),
          isSelected: false,
        };
      })
      .filter((item): item is { content: string; metaJson: string; isSelected: boolean } => !!item);

    const outlineDirections = (parsed.outlineDirections || [])
      .map((item) => {
        const title = cleanText(item.title, 32);
        const summary = cleanText(item.summary, 160);
        const beats = Array.isArray(item.beats)
          ? item.beats
              .map((beat) => cleanText(beat, 60))
              .filter(Boolean)
              .slice(0, 5)
          : [];
        const outlineTree = sanitizeOutlineTree(item.outlineTree);
        if (!title && !summary && outlineTree.length === 0) {
          return null;
        }
        return {
          content: title ? `${title}：${summary || beats[0] || '可转为大纲草案'}` : summary,
          metaJson: JSON.stringify({ title, summary, beats, outlineTree }),
          isSelected: false,
        };
      })
      .filter((item): item is { content: string; metaJson: string; isSelected: boolean } => !!item);

    return {
      loglines: markFirstSelected(loglines),
      sceneHooks: markFirstSelected(sceneHooks),
      outlineDirections: markFirstSelected(outlineDirections),
    };
  } catch {
    return null;
  }
}

export function buildOutlineTreeFromIdeaOutput(
  draft: StoryIdeaCardDraft,
  output: StoryIdeaOutputRow | null | undefined
): PersistedOutlineNodeInput[] {
  if (!output) return [];

  try {
    const parsed = JSON.parse(output.meta_json) as {
      title?: string;
      summary?: string;
      beats?: string[];
      outlineTree?: PersistedOutlineNodeInput[];
    };
    const outlineTree = sanitizeOutlineTree(parsed.outlineTree);
    if (outlineTree.length > 0) {
      return outlineTree;
    }

    const beatNodes = Array.isArray(parsed.beats)
      ? parsed.beats
          .map((beat, index) => ({
            title: cleanText(beat, 36) || `推进 ${index + 1}`,
            content: '',
            children: [],
            sortOrder: index,
          }))
          .filter((node) => node.title)
      : [];

    return [
      {
        title: cleanText(parsed.title, 32) || draft.title || '三签草案',
        content: cleanText(parsed.summary, 80) || draft.premise,
        sortOrder: 0,
        children: beatNodes,
      },
    ];
  } catch {
    return [
      {
        title: draft.title || '三签草案',
        content: output.content,
        sortOrder: 0,
        children: [],
      },
    ];
  }
}
