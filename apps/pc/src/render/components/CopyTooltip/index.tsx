import React, { useState, useRef, useCallback } from 'react';
import styles from './styles.module.scss';

interface CopyTooltipProps {
  /** The full text to display in the tooltip and copy to clipboard */
  text: string;
  /** Visible label (e.g. truncated). If omitted, shows `text` directly */
  children: React.ReactNode;
  /** Tooltip position */
  position?: 'top' | 'bottom';
  /** Hover delay in ms */
  delay?: number;
}

const CopyTooltip: React.FC<CopyTooltipProps> = ({
  text,
  children,
  position = 'top',
  delay = 300,
}) => {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <span className={styles.wrapper} onMouseEnter={show} onMouseLeave={hide} onClick={handleClick}>
      {children}
      {visible && text && (
        <span className={`${styles.tooltip} ${styles[position]}`}>
          {copied ? '已复制 ✓' : text}
        </span>
      )}
    </span>
  );
};

export default CopyTooltip;
