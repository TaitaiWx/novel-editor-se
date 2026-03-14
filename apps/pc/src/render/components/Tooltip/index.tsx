import React, { useState, useRef, useCallback } from 'react';
import styles from './styles.module.scss';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
  delay?: number;
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top', delay = 300 }) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  return (
    <span className={styles.wrapper} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && content && (
        <span className={`${styles.tooltip} ${styles[position]}`}>{content}</span>
      )}
    </span>
  );
};

export default Tooltip;
