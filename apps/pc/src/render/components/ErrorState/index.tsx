import React from 'react';
import styles from './styles.module.scss';

interface ErrorStateProps {
  icon?: string;
  title?: string;
  message?: string;
  size?: 'small' | 'medium' | 'large';
  onRetry?: () => void;
}

const ErrorState: React.FC<ErrorStateProps> = ({
  icon = '⚠️',
  title = '出现错误',
  message,
  size = 'medium',
  onRetry,
}) => {
  return (
    <div className={`${styles.errorStateContainer} ${styles[size]}`}>
      <div className={styles.errorIcon}>{icon}</div>
      <h3 className={styles.errorTitle}>{title}</h3>
      {message && <p className={styles.errorMessage}>{message}</p>}
      {onRetry && (
        <button className={styles.retryButton} onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
};

export default ErrorState;
