import React from 'react';
import type { GrowthWarning } from '@novel-editor/core/growth';
import styles from './styles.module.scss';

const SEVERITY_LABELS: Record<GrowthWarning['severity'], string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
};

interface GrowthWarningListProps {
  warnings: GrowthWarning[];
  title?: string;
  /** 是否显示角色名（汇总视图） */
  showCharacter?: boolean;
  emptyText?: string;
}

/**
 * 战力一致性警告列表：error / warning / info 三级，hint 以 tooltip 展示
 */
export const GrowthWarningList: React.FC<GrowthWarningListProps> = ({
  warnings,
  title = '战力一致性',
  showCharacter = false,
  emptyText = '没有发现战力崩溃的迹象',
}) => (
  <div className={styles.card}>
    <div className={styles.title}>
      <span>{title}</span>
      <span className={styles.count}>{warnings.length} 项</span>
    </div>
    {warnings.length === 0 ? (
      <div className={styles.ok}>{emptyText}</div>
    ) : (
      <ul className={styles.list}>
        {warnings.map((warning, index) => (
          <li
            key={`${warning.code}-${warning.character ?? ''}-${index}`}
            className={`${styles.item} ${styles[warning.severity]}`}
            title={warning.hint ?? ''}
          >
            <span className={styles.badge}>{SEVERITY_LABELS[warning.severity]}</span>
            <span className={styles.message}>
              {showCharacter && warning.character ? `${warning.character}：` : ''}
              {warning.message}
              {warning.hint && <span className={styles.hint}>{warning.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

export default GrowthWarningList;
