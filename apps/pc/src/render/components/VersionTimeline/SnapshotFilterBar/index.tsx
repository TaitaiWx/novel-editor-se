/**
 * SnapshotFilterBar — 版本列表筛选栏（关键词 + 时间范围）
 */
import React from 'react';
import { VscSearch, VscListFilter } from 'react-icons/vsc';
import type { SnapshotTimeFilter } from '../types';
import styles from './styles.module.scss';

const TIME_FILTER_OPTIONS: Array<[SnapshotTimeFilter, string]> = [
  ['all', '全部'],
  ['today', '今天'],
  ['7d', '7 天'],
  ['30d', '30 天'],
];

export interface SnapshotFilterBarProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  timeFilter: SnapshotTimeFilter;
  onTimeFilterChange: (value: SnapshotTimeFilter) => void;
  filteredCount: number;
  totalCount: number;
}

const SnapshotFilterBar: React.FC<SnapshotFilterBarProps> = ({
  searchQuery,
  onSearchQueryChange,
  timeFilter,
  onTimeFilterChange,
  filteredCount,
  totalCount,
}) => {
  return (
    <div className={styles.filterBar}>
      <div className={styles.filterSearchWrap}>
        <VscSearch className={styles.filterIcon} />
        <input
          className={styles.filterSearchInput}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="按版本说明筛选"
        />
      </div>
      <div className={styles.filterActions}>
        <span className={styles.filterLabel}>
          <VscListFilter />
          <span>时间范围</span>
        </span>
        {TIME_FILTER_OPTIONS.map(([value, label]) => (
          <button
            key={value}
            className={`${styles.filterChip} ${timeFilter === value ? styles.filterChipActive : ''}`}
            onClick={() => onTimeFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.filterSummary}>
        {filteredCount} / {totalCount}
      </div>
    </div>
  );
};

export default SnapshotFilterBar;
