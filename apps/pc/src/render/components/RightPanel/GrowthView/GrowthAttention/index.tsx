import React, { useState } from 'react';
import type { ForgottenCompanion, GrowthWarning } from '../../../../types/growth-api';
import { HelpTip } from '../HelpTip';
import { GROWTH_TIPS } from '../growthGuide';
import { countAttention } from '../growthText';
import styles from './styles.module.scss';

interface GrowthAttentionProps {
  warnings: GrowthWarning[];
  forgotten: ForgottenCompanion[];
  /** 汇总视图中在每条前显示角色名 */
  showCharacter?: boolean;
  defaultExpanded?: boolean;
}

/**
 * 需要留意的事项：只在存在战力冲突 / 警告或被遗忘的配角时出现，默认收起成一行
 */
export const GrowthAttention: React.FC<GrowthAttentionProps> = ({
  warnings,
  forgotten,
  showCharacter = false,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const attention = countAttention(warnings, forgotten);
  if (attention.total === 0) return null;

  const visible = warnings.filter((warning) => warning.severity !== 'info');
  const parts: string[] = [];
  if (attention.errors > 0) parts.push(`${attention.errors} 处违背规则`);
  if (attention.warnings > 0) parts.push(`${attention.warnings} 处战力涨得偏快`);
  if (attention.forgotten > 0) parts.push(`${attention.forgotten} 位配角很久没出场`);

  return (
    <section
      className={`${styles.banner} ${attention.errors > 0 ? styles.bannerError : ''}`}
      aria-label="需要留意"
      data-growth-tour="warnings"
    >
      <div className={styles.head}>
        <span className={styles.dot} aria-hidden="true" />
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={styles.summary}>需要留意：{parts.join(' · ')}</span>
          <span className={styles.more}>{expanded ? '收起' : '查看'}</span>
        </button>
        <HelpTip text={GROWTH_TIPS.warnings} label="提醒说明" />
      </div>
      {expanded && (
        <ul className={styles.list}>
          {visible.map((warning, index) => (
            <li key={`${warning.code}-${warning.character ?? ''}-${index}`} className={styles.item}>
              <span
                className={`${styles.tag} ${warning.severity === 'error' ? styles.tagError : ''}`}
              >
                {warning.severity === 'error' ? '违背规则' : '偏快'}
              </span>
              <span className={styles.text}>
                {showCharacter && warning.character ? `${warning.character}：` : ''}
                {warning.message}
                {warning.hint && <span className={styles.hint}>{warning.hint}</span>}
              </span>
            </li>
          ))}
          {forgotten.map((item) => (
            <li key={`forgotten-${item.name}`} className={styles.item}>
              <span className={`${styles.tag} ${styles.tagCompanion}`}>配角</span>
              <span className={styles.text}>
                {item.name} 已 {item.chaptersAbsent} 章未出场
                {item.important ? '（重点配角）' : ''}
                <span className={styles.hint}>
                  上次出场第 {item.lastSeenChapter} 章
                  {item.parties.length > 0 ? ` · 曾在 ${item.parties.join('、')}` : ''}
                  ，可以考虑安排回归
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default GrowthAttention;
