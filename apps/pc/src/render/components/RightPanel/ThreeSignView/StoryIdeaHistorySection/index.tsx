import React from 'react';
import type { StoryIdeaCardRow } from '@/render/types/electron-api';
import styles from '../../styles.module.scss';
import { FlowCollapsibleCard } from '../../FlowCards';
import {
  STORY_IDEA_STATUS_LABELS,
  toStoryIdeaDraft,
  type StoryIdeaCardDraft,
} from '../../story-idea';
import { getTermSummary, type StoryIdeaInteractionMode } from '../helpers';
import type { StoryIdeaHistoryFilter } from '../useStoryIdeaHistoryFilter';

interface StoryIdeaHistorySectionProps {
  interactionMode: StoryIdeaInteractionMode;
  historyExpanded: boolean;
  setHistoryExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  cards: StoryIdeaCardRow[];
  activeCard: StoryIdeaCardRow | null;
  activeCardId: number | null;
  setActiveCardId: (cardId: number) => void;
  draft: StoryIdeaCardDraft;
  saving: boolean;
  loading: boolean;
  outputsLoading: boolean;
  working: boolean;
  aiConfig: { loaded: boolean; ready: boolean };
  history: StoryIdeaHistoryFilter;
}

/**
 * ① 历史搜索：从已有创意卡里检索、切换当前卡。
 */
export const StoryIdeaHistorySection: React.FC<StoryIdeaHistorySectionProps> = ({
  interactionMode,
  historyExpanded,
  setHistoryExpanded,
  cards,
  activeCard,
  activeCardId,
  setActiveCardId,
  draft,
  saving,
  loading,
  outputsLoading,
  working,
  aiConfig,
  history,
}) => {
  const {
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
  } = history;

  return (
    <div className={styles.storyIdeaTopSection}>
      <FlowCollapsibleCard
        tone="info"
        title="① 历史搜索"
        subtitle="先从已有灵感里找接近的卡，再决定复用、扩写还是新起一张。"
        expanded={interactionMode === 'advanced' ? true : historyExpanded}
        onToggle={() => setHistoryExpanded((current) => !current)}
        meta={
          <div className={styles.storyIdeaStatsRow}>
            <span className={styles.outlineStatChip}>{cards.length} 张创意卡</span>
            {activeCard && (
              <span className={styles.outlineStatChip}>
                当前卡: {draft.title.trim() || '未命名创意卡'}
              </span>
            )}
            {activeCard && (
              <span className={styles.outlineStatChip}>
                {STORY_IDEA_STATUS_LABELS[draft.status]}
              </span>
            )}
            {saving && <span className={styles.outlineLoadingChip}>自动保存中...</span>}
            {loading && <span className={styles.outlineLoadingChip}>加载中...</span>}
            {outputsLoading && <span className={styles.outlineLoadingChip}>同步候选...</span>}
            {working && <span className={styles.outlineLoadingChip}>AI 处理中...</span>}
            {!aiConfig.loaded && <span className={styles.outlineLoadingChip}>读取 AI 状态...</span>}
            {aiConfig.loaded && !aiConfig.ready && (
              <span className={styles.outlineAiHintChip}>AI 未就绪</span>
            )}
          </div>
        }
        summary={
          interactionMode === 'guided' ? (
            <div className={styles.storyIdeaCollapsedHistory}>
              {recentCards.length === 0 ? (
                <span className={styles.storyIdeaTermPlaceholder}>
                  还没有历史卡，先新建一张即可。
                </span>
              ) : (
                recentCards.map((card) => (
                  <button
                    key={card.id}
                    className={`${styles.storyIdeaHistoryMiniCard} ${activeCardId === card.id ? styles.storyIdeaHistoryMiniCardActive : ''}`}
                    onClick={() => setActiveCardId(card.id)}
                    type="button"
                  >
                    <span className={styles.storyIdeaHistoryMiniTitle}>{card.title}</span>
                    <span className={styles.storyIdeaHistoryMiniMeta}>
                      {getTermSummary(toStoryIdeaDraft(card)) || '尚未整理签词'}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : undefined
        }
      >
        <div className={styles.storyIdeaFilterPanel}>
          <input
            className={styles.storyIdeaInput}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜标题、premise、签词"
          />
          {interactionMode === 'advanced' && (
            <>
              <div className={styles.storyIdeaFilterRow}>
                <select
                  className={styles.storyIdeaSelect}
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as 'all' | StoryIdeaCardDraft['status'])
                  }
                >
                  <option value="all">全部状态</option>
                  {Object.entries(STORY_IDEA_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  className={styles.storyIdeaInput}
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                  placeholder="按标签检索"
                />
              </div>
              {popularTags.length > 0 && (
                <div className={styles.storyIdeaTagCloud}>
                  {popularTags.map((tag) => (
                    <button
                      key={tag}
                      className={`${styles.storyIdeaTagChip} ${tagFilter === tag ? styles.storyIdeaTagChipActive : ''}`}
                      onClick={() => setTagFilter((current) => (current === tag ? '' : tag))}
                      type="button"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {filteredCards.length === 0 ? (
          <div className={styles.storyIdeaEmptyCard}>
            <div className={styles.storyIdeaEmptyTitle}>没有匹配的创意卡</div>
            <div className={styles.storyIdeaEmptyText}>换个关键词、状态或标签试试。</div>
          </div>
        ) : (
          <div className={styles.storyIdeaHistoryCards}>
            {visibleHistoryCards.map((card) => {
              const draftCard = toStoryIdeaDraft(card);
              return (
                <button
                  key={card.id}
                  className={`${styles.storyIdeaListItem} ${activeCardId === card.id ? styles.storyIdeaListItemActive : ''}`}
                  onClick={() => setActiveCardId(card.id)}
                  type="button"
                >
                  <span className={styles.storyIdeaListTitle}>{card.title}</span>
                  <span className={styles.storyIdeaListMeta}>
                    {new Date(card.updated_at).toLocaleString()} /{' '}
                    {STORY_IDEA_STATUS_LABELS[card.status]}
                  </span>
                  <span className={styles.storyIdeaListSummary}>
                    {draftCard.premise || getTermSummary(draftCard) || '尚未整理签词'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {interactionMode === 'guided' && filteredCards.length > visibleHistoryCards.length && (
          <div className={styles.storyIdeaQuickGuideHint}>
            这里只先显示最近 6 张。想精细筛选时切到“高级模式”。
          </div>
        )}
      </FlowCollapsibleCard>
    </div>
  );
};
