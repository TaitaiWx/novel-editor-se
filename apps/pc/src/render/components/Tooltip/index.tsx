import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './styles.module.scss';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
  delay?: number;
}

type TooltipPlacement = 'top' | 'bottom';

const VIEWPORT_PADDING = 8;
const TOOLTIP_GAP = 6;

const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top', delay = 300 }) => {
  const [visible, setVisible] = useState(false);
  const [placement, setPlacement] = useState<TooltipPlacement>(position);
  const [coords, setCoords] = useState({ left: 0, top: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);

  const show = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!visible || !trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let nextPlacement: TooltipPlacement = position;
    let top =
      nextPlacement === 'top'
        ? triggerRect.top - tooltipRect.height - TOOLTIP_GAP
        : triggerRect.bottom + TOOLTIP_GAP;

    if (nextPlacement === 'top' && top < VIEWPORT_PADDING) {
      nextPlacement = 'bottom';
      top = triggerRect.bottom + TOOLTIP_GAP;
    } else if (
      nextPlacement === 'bottom' &&
      top + tooltipRect.height > viewportHeight - VIEWPORT_PADDING
    ) {
      nextPlacement = 'top';
      top = triggerRect.top - tooltipRect.height - TOOLTIP_GAP;
    }

    let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(VIEWPORT_PADDING, left);
    left = Math.min(left, viewportWidth - tooltipRect.width - VIEWPORT_PADDING);

    setPlacement(nextPlacement);
    setCoords({ left, top: Math.max(VIEWPORT_PADDING, top) });
  }, [position, visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [updatePosition, visible]);

  return (
    <span ref={triggerRef} className={styles.wrapper} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible &&
        content &&
        createPortal(
          <span
            ref={tooltipRef}
            className={`${styles.tooltip} ${placement === 'top' ? styles.top : styles.bottom}`}
            style={{ left: `${coords.left}px`, top: `${coords.top}px` }}
            role="tooltip"
          >
            {content}
          </span>,
          document.body
        )}
    </span>
  );
};

export default Tooltip;
