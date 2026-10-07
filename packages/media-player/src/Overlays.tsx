/**
 * 画面上的浮层：加载中、错误（可重试）、短暂提示（截图 / 录制结果）、录制中标记。
 */
import React from 'react';
import { VscLoading, VscRefresh, VscWarning } from 'react-icons/vsc';
import { formatTime } from './format';
import styles from './styles.module.scss';

export const LoadingOverlay: React.FC = () => (
  <div className={styles.loading} role="status" aria-label="加载中" data-testid="video-loading">
    <VscLoading className={styles.spinner} />
  </div>
);

export const ErrorOverlay: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className={styles.errorOverlay} role="alert" data-testid="video-error">
    <VscWarning className={styles.errorIcon} />
    <span className={styles.errorText}>{message}</span>
    <button
      type="button"
      className={styles.retry}
      onClick={(event) => {
        event.stopPropagation();
        onRetry();
      }}
    >
      <VscRefresh />
      <span>重试</span>
    </button>
  </div>
);

export const NoticeOverlay: React.FC<{ message: string; tone: 'info' | 'error' }> = ({
  message,
  tone,
}) => (
  <div
    className={`${styles.notice} ${tone === 'error' ? styles.noticeError : ''}`}
    role={tone === 'error' ? 'alert' : 'status'}
    data-testid="video-notice"
  >
    {message}
  </div>
);

export const RecordingBadge: React.FC<{ elapsed: number }> = ({ elapsed }) => (
  <div className={styles.recBadge} aria-hidden="true">
    <span className={styles.recDot} />
    REC {formatTime(elapsed)}
  </div>
);
