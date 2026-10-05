import React, { useState } from 'react';
import {
  describeGrowthEvent,
  type GrowthRuleset,
  type GrowthSheet,
} from '@novel-editor/core/growth';
import styles from './styles.module.scss';

const SOURCE_LABELS: Record<string, string> = {
  'ai-sim': 'AI 推演',
  cli: 'CLI',
  gui: '',
  manual: '',
};

interface GrowthTimelineProps {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
  busy: boolean;
  onUpdateNotes: (notes: string[]) => Promise<string | null>;
}

const PAGE_SIZE = 20;

/**
 * 状态备注 + 成长时间线（最新在上）
 */
export const GrowthTimeline: React.FC<GrowthTimelineProps> = ({
  ruleset,
  sheet,
  busy,
  onUpdateNotes,
}) => {
  const [draft, setDraft] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const events = [...sheet.events].reverse();

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.title}>
          <span>状态备注</span>
          <span className={styles.meta} title="伤势、装备、心境等长期状态，AI 推演时会参考">
            ?
          </span>
        </div>
        {sheet.notes.length === 0 && <div className={styles.empty}>暂无状态备注</div>}
        {sheet.notes.map((note, index) => (
          <div key={`${note}-${index}`} className={styles.note}>
            <span>{note}</span>
            <button
              type="button"
              className={styles.remove}
              disabled={busy}
              aria-label={`删除备注 ${note}`}
              onClick={() => void onUpdateNotes(sheet.notes.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        ))}
        <form
          className={styles.noteForm}
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text) return;
            void onUpdateNotes([...sheet.notes, text]).then((error) => {
              if (!error) setDraft('');
            });
          }}
        >
          <input
            className={styles.input}
            value={draft}
            placeholder="例如：左臂旧伤未愈，不能使用双手武器"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className={styles.button} disabled={busy || !draft.trim()}>
            添加
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <div className={styles.title}>
          <span>成长时间线</span>
          <span className={styles.meta}>{sheet.events.length} 条</span>
        </div>
        {events.length === 0 && <div className={styles.empty}>还没有成长记录</div>}
        <ol className={styles.timeline}>
          {events.slice(0, limit).map((event) => {
            const source = SOURCE_LABELS[event.source ?? ''] ?? '';
            return (
              <li key={event.id} className={styles.item}>
                <span className={styles.chapter}>
                  {event.chapter !== undefined ? `第${event.chapter}章` : '—'}
                </span>
                <div className={styles.body}>
                  <div className={styles.what}>
                    {describeGrowthEvent(ruleset, event)}
                    {event.levelBefore !== undefined && event.levelAfter !== undefined && (
                      <span className={styles.levelUp}>
                        Lv {event.levelBefore} → {event.levelAfter}
                      </span>
                    )}
                    {source && <span className={styles.source}>{source}</span>}
                  </div>
                  {event.note && <div className={styles.why}>{event.note}</div>}
                </div>
              </li>
            );
          })}
        </ol>
        {events.length > limit && (
          <button
            type="button"
            className={styles.more}
            onClick={() => setLimit((value) => value + PAGE_SIZE)}
          >
            显示更早的 {Math.min(PAGE_SIZE, events.length - limit)} 条
          </button>
        )}
      </div>
    </div>
  );
};

export default GrowthTimeline;
