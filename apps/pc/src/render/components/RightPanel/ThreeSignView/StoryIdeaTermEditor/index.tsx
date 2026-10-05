import React from 'react';
import styles from '../../styles.module.scss';
import { FlowCollapsibleCard } from '../../FlowCards';
import {
  buildStoryIdeaTermSummary,
  normalizeIdeaTerms,
  STORY_IDEA_TERM_POOL_SOURCE_LABELS,
  type StoryIdeaTermPoolEntry,
  type StoryIdeaTermSection,
} from '../../story-idea';

/**
 * 单张签卡编辑器：签词输入、词池抽取、AI 补词与可点选词池。
 */
export function StoryIdeaTermEditor({
  section,
  label,
  description,
  isExpanded,
  value,
  poolTerms,
  compactMode,
  placeholder,
  working,
  onToggle,
  onChange,
  onAddCurrentToPool,
  onQuickFillFromPool,
  onRequestRelated,
  onRedrawRandom,
  onPickPoolTerm,
}: {
  section: StoryIdeaTermSection;
  label: string;
  description: string;
  isExpanded: boolean;
  value: string[];
  poolTerms: StoryIdeaTermPoolEntry[];
  compactMode: boolean;
  placeholder: string;
  working: boolean;
  onToggle: (section: StoryIdeaTermSection) => void;
  onChange: (next: string[]) => void;
  onAddCurrentToPool: (section: StoryIdeaTermSection) => void;
  onQuickFillFromPool: (section: StoryIdeaTermSection) => void;
  onRequestRelated: (section: StoryIdeaTermSection) => void;
  onRedrawRandom: (section: StoryIdeaTermSection) => void;
  onPickPoolTerm: (section: StoryIdeaTermSection, term: string) => void;
}) {
  const summary = buildStoryIdeaTermSummary(value, 3);
  return (
    <FlowCollapsibleCard
      title={label}
      subtitle={description}
      expanded={isExpanded}
      onToggle={() => onToggle(section)}
      tone={isExpanded ? 'info' : 'default'}
      meta={
        <>
          <span className={styles.storyIdeaTermCardCount}>{value.length}/5</span>
          <span className={styles.storyIdeaTermCardToggle}>{isExpanded ? '收起' : '展开'}</span>
        </>
      }
      summary={
        <div className={styles.storyIdeaTermSummaryBar}>
          <span className={styles.storyIdeaTermSummaryLabel}>摘要</span>
          <div className={styles.storyIdeaTermSummaryContent}>
            {summary.visibleTerms.length === 0 ? (
              <span className={styles.storyIdeaTermPlaceholder}>
                任选这一张先起手，填 3-5 个即可
              </span>
            ) : (
              <>
                {summary.visibleTerms.map((item) => (
                  <span key={`${label}-${item}`} className={styles.storyIdeaTermChip}>
                    {item}
                  </span>
                ))}
                {summary.hiddenCount > 0 && (
                  <span className={styles.storyIdeaTermOverflowChip}>+{summary.hiddenCount}</span>
                )}
              </>
            )}
          </div>
        </div>
      }
    >
      <div className={styles.storyIdeaTermGroup}>
        <label className={styles.storyIdeaField}>
          <span className={styles.storyIdeaFieldLabel}>签词输入</span>
          <input
            className={styles.storyIdeaInput}
            value={value.join('，')}
            onChange={(event) => onChange(normalizeIdeaTerms(event.target.value))}
            placeholder={placeholder}
          />
        </label>
        <div className={styles.storyIdeaTermActions}>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => onQuickFillFromPool(section)}
            disabled={working || poolTerms.length === 0}
            type="button"
          >
            词池抽 3 个
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => onRequestRelated(section)}
            disabled={working}
            type="button"
          >
            {compactMode ? 'AI 补词' : 'AI 提相关'}
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => onRedrawRandom(section)}
            disabled={working}
            type="button"
          >
            {compactMode ? '换一组' : '随机重抽一签'}
          </button>
          {!compactMode && (
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => onAddCurrentToPool(section)}
              disabled={working || value.length === 0}
              type="button"
            >
              收进词池
            </button>
          )}
        </div>
        <div className={styles.storyIdeaPoolBox}>
          <div className={styles.storyIdeaPoolTitle}>可直接点选的词池</div>
          <div className={styles.storyIdeaTagCloud}>
            {poolTerms.length === 0 ? (
              <span className={styles.storyIdeaTermPlaceholder}>历史词、AI 提词会沉淀到这里</span>
            ) : (
              poolTerms.map((item) => (
                <button
                  key={`${section}-${item.term}`}
                  className={styles.storyIdeaPoolChip}
                  onClick={() => onPickPoolTerm(section, item.term)}
                  type="button"
                >
                  <span>{item.term}</span>
                  <span className={styles.storyIdeaPoolSources}>
                    {item.sources.map((source) => (
                      <span
                        key={`${item.term}-${source}`}
                        className={styles.storyIdeaPoolSourceBadge}
                      >
                        {STORY_IDEA_TERM_POOL_SOURCE_LABELS[source]}
                      </span>
                    ))}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </FlowCollapsibleCard>
  );
}
