import type {
  PersistedOutlineNodeInput,
  PersistedOutlineScopeKind,
  PersistedOutlineVersionRow,
} from '@/render/types/electron-api';
import type { OutlineEntry } from '../types';
import type { OutlineAiGenerationOptions } from '../outline-import';
import { parseStoryIdeaSnapshot } from '../story-idea';
import { requestOpenInspiration } from '../../InspirationDialog/inspiration';

// 大纲视图内部使用的纯函数与常量

export function buildDiffLine(title: string, content: string | undefined, level: number): string {
  const indent = '  '.repeat(Math.max(0, level - 1));
  const summary = (content || '').replace(/\s+/g, ' ').trim();
  return summary ? `${indent}- ${title} :: ${summary}` : `${indent}- ${title}`;
}

export function serializeVersionTree(nodes: PersistedOutlineNodeInput[], level = 1): string[] {
  return nodes.flatMap((node) => [
    buildDiffLine(node.title, node.content, level),
    ...serializeVersionTree(node.children || [], level + 1),
  ]);
}

export function parseVersionTree(version: PersistedOutlineVersionRow): PersistedOutlineNodeInput[] {
  try {
    const parsed = JSON.parse(version.tree_json) as PersistedOutlineNodeInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeCurrentEntries(entries: OutlineEntry[]): string {
  return entries.map((entry) => buildDiffLine(entry.text, entry.summary, entry.level)).join('\n');
}

export function getOutlineScopeLabel(scopeKind: PersistedOutlineScopeKind): string {
  switch (scopeKind) {
    case 'chapter':
      return '章纲';
    case 'volume':
      return '卷纲';
    default:
      return '作品大纲';
  }
}

export function buildCompareLabel(
  name: string | null,
  scopeKind: PersistedOutlineScopeKind
): string {
  return name ? `版本 ${name}` : `当前${getOutlineScopeLabel(scopeKind)}`;
}

export function buildStoryIdeaTermsPreview(version: PersistedOutlineVersionRow): string[] {
  const snapshot = parseStoryIdeaSnapshot(version.story_idea_snapshot_json);
  if (!snapshot) return [];
  return [...snapshot.themeTerms, ...snapshot.conflictTerms, ...snapshot.twistTerms].slice(0, 9);
}

export function buildStoryIdeaCardTitle(version: PersistedOutlineVersionRow): string {
  const snapshot = parseStoryIdeaSnapshot(version.story_idea_snapshot_json);
  const title = snapshot?.title.trim();
  if (title) return title;
  if (version.story_idea_card_id !== null) return `三签卡 #${version.story_idea_card_id}`;
  return '三签创意卡';
}

/** 回到大纲版本的来源：在「灵感」弹窗中回填这张三签卡 */
export function jumpToStoryIdeaCard(cardId: number | null) {
  if (cardId === null) return;
  requestOpenInspiration({ cardId });
}

/** 版本来源标签 */
export const OUTLINE_VERSION_SOURCE_LABELS = {
  import: '导入',
  rebuild: '重建',
  ai: 'AI',
  manual: '手工',
};

/** AI 生成大纲预设 */
export const OUTLINE_AI_PRESETS = [
  {
    key: 'balanced',
    label: '均衡成章',
    description: '稳定章节骨架，适合先拿到可写主线。',
    value: {
      style: 'balanced',
      granularity: 'medium',
      maxDepth: 3,
    } as OutlineAiGenerationOptions,
  },
  {
    key: 'cinematic',
    label: '影视拆场',
    description: '突出节拍和场景推进，适合镜头化思考。',
    value: {
      style: 'cinematic',
      granularity: 'fine',
      maxDepth: 4,
    } as OutlineAiGenerationOptions,
  },
  {
    key: 'detailed',
    label: '细纲推进',
    description: '优先拿到可直接展开写作的细颗粒度节点。',
    value: {
      style: 'detailed',
      granularity: 'fine',
      maxDepth: 4,
    } as OutlineAiGenerationOptions,
  },
  {
    key: 'suspense',
    label: '悬疑钩子',
    description: '强化钩子、揭示和反转节奏。',
    value: {
      style: 'suspense',
      granularity: 'medium',
      maxDepth: 3,
    } as OutlineAiGenerationOptions,
  },
];
