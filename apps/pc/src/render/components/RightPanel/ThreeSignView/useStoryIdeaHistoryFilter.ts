import { useMemo, useState } from 'react';
import type { StoryIdeaCardRow } from '@/render/types/electron-api';
import { buildStoryIdeaSearchText, toStoryIdeaDraft, type StoryIdeaCardDraft } from '../story-idea';
import type { StoryIdeaInteractionMode } from './helpers';

/**
 * 历史创意卡检索：关键词 / 状态 / 标签筛选与热门标签统计。
 */
export function useStoryIdeaHistoryFilter(
  cards: StoryIdeaCardRow[],
  interactionMode: StoryIdeaInteractionMode
) {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StoryIdeaCardDraft['status']>('all');
  const [tagFilter, setTagFilter] = useState('');

  const filteredCards = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedTag = tagFilter.trim().toLowerCase();
    return cards.filter((card) => {
      const draftCard = toStoryIdeaDraft(card);
      const matchesKeyword =
        !normalizedKeyword || buildStoryIdeaSearchText(draftCard).includes(normalizedKeyword);
      const matchesStatus = statusFilter === 'all' || card.status === statusFilter;
      const matchesTag =
        !normalizedTag || draftCard.tags.some((tag) => tag.toLowerCase().includes(normalizedTag));
      return matchesKeyword && matchesStatus && matchesTag;
    });
  }, [cards, keyword, statusFilter, tagFilter]);

  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    cards.forEach((card) => {
      toStoryIdeaDraft(card).tags.forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [cards]);

  const visibleHistoryCards = useMemo(
    () => (interactionMode === 'guided' ? filteredCards.slice(0, 6) : filteredCards),
    [filteredCards, interactionMode]
  );

  const recentCards = useMemo(() => cards.slice(0, 4), [cards]);

  return {
    keyword,
    setKeyword,
    statusFilter,
    setStatusFilter,
    tagFilter,
    setTagFilter,
    filteredCards,
    popularTags,
    visibleHistoryCards,
    recentCards,
  };
}

export type StoryIdeaHistoryFilter = ReturnType<typeof useStoryIdeaHistoryFilter>;
