import React from 'react';
import styles from './styles.module.scss';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'small' | 'medium' | 'large';
}

const SIZE_MAP = { small: 28, medium: 40, large: 56 };

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = '正在加载...',
  size = 'medium',
}) => {
  const s = SIZE_MAP[size];

  return (
    <div className={`${styles.loadingSpinnerContainer} ${styles[size]}`}>
      <svg
        className={styles.spinner}
        width={s}
        height={s}
        viewBox="0 0 50 50"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="loading-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#569cd6" />
            <stop offset="100%" stopColor="#4ec9b0" />
          </linearGradient>
        </defs>
        {/* Background track */}
        <circle className={styles.track} cx="25" cy="25" r="20" fill="none" strokeWidth="3" />
        {/* Animated arc */}
        <circle
          className={styles.arc}
          cx="25"
          cy="25"
          r="20"
          fill="none"
          stroke="url(#loading-gradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="80 126"
        />
        {/* Pulsing center dot */}
        <circle className={styles.pulse} cx="25" cy="25" r="3" fill="#569cd6" />
      </svg>
      {message && <p className={styles.loadingMessage}>{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
