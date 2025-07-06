import React from 'react';
import styles from './styles.module.scss';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'small' | 'medium' | 'large';
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = '正在加载...',
  size = 'medium',
}) => {
  return (
    <div className={`${styles.loadingSpinnerContainer} ${styles[size]}`}>
      <div className={styles.loadingSpinner}></div>
      {message && <p className={styles.loadingMessage}>{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
