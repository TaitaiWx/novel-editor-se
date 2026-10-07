import React, { useState } from 'react';
import type { StoryIdeaCardRow } from '@/render/types/electron-api';
import {
  STORY_IDEA_GENERATION_SCOPE_LABELS,
  type StoryIdeaGenerationScope,
} from '../../RightPanel/story-idea';
import {
  INSPIRATION_SLOTS,
  INSPIRATION_SLOT_LABELS,
  INSPIRATION_SOURCE_LABELS,
  storyIdeaCardToInspiration,
  formatInspiration,
  type InspirationDraw,
  type InspirationSlot,
  type InspirationSource,
} from '../inspiration';
import Select from '../../Select';
import styles from './styles.module.scss';

const SOURCES = Object.keys(INSPIRATION_SOURCE_LABELS) as InspirationSource[];
const SCOPES = Object.keys(STORY_IDEA_GENERATION_SCOPE_LABELS) as StoryIdeaGenerationScope[];
const HISTORY_LIMIT = 8;

interface InspirationAdvancedProps {
  source: InspirationSource;
  onSourceChange: (source: InspirationSource) => void;
  scope: StoryIdeaGenerationScope;
  onScopeChange: (scope: StoryIdeaGenerationScope) => void;
  /** 未开启 AI 时隐藏「AI 扩写范围」 */
  showScope: boolean;
  /** 未打开作品 / 数据库未就绪时不能写词池与历史 */
  canPersist: boolean;
  cards: StoryIdeaCardRow[];
  onAddTerm: (slot: InspirationSlot, term: string) => Promise<boolean>;
  onPickHistory: (draw: InspirationDraw) => void;
}

/** 灵感抽签的「更多选项」：词源、AI 扩写范围、我的词池、历史 */
export const InspirationAdvanced: React.FC<InspirationAdvancedProps> = ({
  source,
  onSourceChange,
  scope,
  onScopeChange,
  showScope,
  canPersist,
  cards,
  onAddTerm,
  onPickHistory,
}) => {
  const [termSlot, setTermSlot] = useState<InspirationSlot>('person');
  const [term, setTerm] = useState('');
  const [termNotice, setTermNotice] = useState('');
  const history = cards
    .map((card) => ({ card, draw: storyIdeaCardToInspiration(card) }))
    .filter((item): item is { card: StoryIdeaCardRow; draw: InspirationDraw } => !!item.draw)
    .slice(0, HISTORY_LIMIT);

  const handleAddTerm = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = term.trim();
    if (!value) return;
    const ok = await onAddTerm(termSlot, value);
    setTermNotice(ok ? `已把「${value}」加入${INSPIRATION_SLOT_LABELS[termSlot]}词池` : '保存失败');
    if (ok) setTerm('');
  };

  return (
    <div className={styles.advanced}>
      <div className={styles.group}>
        <div className={styles.groupLabel}>词源</div>
        <div className={styles.chips} role="radiogroup" aria-label="词源">
          {SOURCES.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={source === item}
              className={`${styles.chip} ${source === item ? styles.chipActive : ''}`}
              onClick={() => onSourceChange(item)}
            >
              {INSPIRATION_SOURCE_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      {showScope && (
        <div className={styles.group}>
          <div className={styles.groupLabel}>AI 扩写范围</div>
          <div className={styles.chips} role="radiogroup" aria-label="AI 扩写范围">
            {SCOPES.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={scope === item}
                className={`${styles.chip} ${scope === item ? styles.chipActive : ''}`}
                onClick={() => onScopeChange(item)}
              >
                {STORY_IDEA_GENERATION_SCOPE_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
      )}

      {canPersist && (
        <form className={styles.group} onSubmit={(event) => void handleAddTerm(event)}>
          <div className={styles.groupLabel}>我的词池</div>
          <div className={styles.termRow}>
            <Select<InspirationSlot>
              className={styles.select}
              aria-label="加入哪一签"
              value={termSlot}
              options={INSPIRATION_SLOTS.map((slot) => ({
                value: slot,
                label: INSPIRATION_SLOT_LABELS[slot],
              }))}
              onChange={setTermSlot}
            />
            <input
              className={styles.input}
              aria-label="新词"
              placeholder="例如：雨夜的渡口"
              maxLength={16}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            <button type="submit" className={styles.addButton} disabled={!term.trim()}>
              加入
            </button>
          </div>
          {termNotice && <div className={styles.notice}>{termNotice}</div>}
        </form>
      )}

      {canPersist && (
        <div className={styles.group}>
          <div className={styles.groupLabel}>历史</div>
          {history.length > 0 ? (
            <ul className={styles.history} aria-label="灵感历史">
              {history.map(({ card, draw }) => (
                <li key={card.id}>
                  <button
                    type="button"
                    className={styles.historyItem}
                    title="回填这一签"
                    onClick={() => onPickHistory(draw)}
                  >
                    <span className={styles.historyTitle}>{card.title}</span>
                    <span className={styles.historyText}>{formatInspiration(draw)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.notice}>插入、复制或扩写过的灵感会出现在这里。</div>
          )}
        </div>
      )}
    </div>
  );
};

export default InspirationAdvanced;
