import React, { useMemo, useState } from 'react';
import {
  describeGrowthEvent,
  type GrowthRuleset,
  type GrowthSheet,
} from '@novel-editor/core/growth';
import { HelpTip } from '../HelpTip';
import { GROWTH_TIPS } from '../growthGuide';
import { groupEventsByChapter } from '../growthText';
import styles from './styles.module.scss';

const SOURCE_LABELS: Record<string, string> = {
  'ai-sim': 'AI 推演',
  cli: '命令行',
};

interface GrowthTimelineProps {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
}

const PAGE_SIZE = 12;

/** 成长时间线：最新在上，按章节分组 */
export const GrowthTimeline: React.FC<GrowthTimelineProps> = ({ ruleset, sheet }) => {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const groups = useMemo(() => groupEventsByChapter(sheet.events), [sheet.events]);
  const shown = groups.slice(0, limit);

  return (
    <section className={styles.card} aria-label="成长时间线">
      <h3 className={styles.title}>
        成长时间线
        <HelpTip text={GROWTH_TIPS.timeline} label="时间线说明" />
        <span className={styles.meta}>
          {sheet.events.length > 0 ? `${sheet.events.length} 笔` : ''}
        </span>
      </h3>
      {groups.length === 0 && (
        <div className={styles.empty}>还没有记录。写完一章后点「记一笔」，这里会按章节排好。</div>
      )}
      <ol className={styles.groups}>
        {shown.map((group, index) => (
          <li key={`${group.chapter ?? 'none'}-${index}`} className={styles.group}>
            <div className={styles.chapter}>
              {group.chapter !== null ? `第 ${group.chapter} 章` : '未标章节'}
            </div>
            <ul className={styles.events}>
              {group.events.map((event) => {
                const source = SOURCE_LABELS[event.source ?? ''] ?? '';
                return (
                  <li key={event.id} className={styles.event}>
                    <div className={styles.what}>
                      <span>{describeGrowthEvent(ruleset, event)}</span>
                      {event.levelBefore !== undefined &&
                        event.levelAfter !== undefined &&
                        event.levelAfter !== event.levelBefore && (
                          <span className={styles.levelUp}>
                            Lv {event.levelBefore} → {event.levelAfter}
                          </span>
                        )}
                      {source && <span className={styles.source}>{source}</span>}
                    </div>
                    {event.note && <div className={styles.why}>{event.note}</div>}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      {groups.length > limit && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setLimit((value) => value + PAGE_SIZE)}
        >
          显示更早的记录
        </button>
      )}
    </section>
  );
};

export default GrowthTimeline;
