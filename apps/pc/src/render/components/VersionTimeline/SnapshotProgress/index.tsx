/**
 * SnapshotProgress — 保存版本任务的进度面板
 */
import React from 'react';
import type { SnapshotJobStatus } from '../types';
import { computeProgressRatio } from '../utils';
import styles from './styles.module.scss';

export interface SnapshotProgressProps {
  job: SnapshotJobStatus;
}

const SnapshotProgress: React.FC<SnapshotProgressProps> = ({ job }) => {
  const progressRatio = computeProgressRatio(job);

  return (
    <div className={styles.progressPanel}>
      <div className={styles.progressHeader}>
        <span>{job.stage === 'scanning' ? '正在扫描项目文件...' : '正在写入版本快照...'}</span>
        <span>
          {job.processedFiles}/{Math.max(job.totalFiles, job.discoveredFiles || 0)}
        </span>
      </div>
      <div className={styles.progressBarTrack}>
        <div
          className={`${styles.progressBarFill} ${job.totalFiles === 0 ? styles.progressBarIndeterminate : ''}`}
          style={job.totalFiles > 0 ? { width: `${progressRatio * 100}%` } : undefined}
        />
      </div>
      <div className={styles.progressMeta}>
        已处理 {Math.round(job.processedBytes / 1024)} KB / {Math.round(job.totalBytes / 1024)} KB
      </div>
    </div>
  );
};

export default SnapshotProgress;
