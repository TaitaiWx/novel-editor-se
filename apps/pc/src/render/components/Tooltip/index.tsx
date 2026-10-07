import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './styles.module.scss';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
  delay?: number;
  /** 包裹元素的附加类名（需要定位包裹元素时使用，例如绝对定位的拖动手柄） */
  className?: string;
  /** 包裹元素的内联样式（例如作为 flex 子项时设置 flexGrow） */
  style?: React.CSSProperties;
  /**
   * 提示挂载的容器，默认 document.body。全屏时只有全屏元素内部会被绘制，
   * 因此触发器位于全屏元素内时自动挂到全屏元素里；也可显式指定（例如播放器全屏时传入播放器根元素）
   */
  portalContainer?: HTMLElement | null;
}

/** 提示挂载位置：显式指定 > 包含触发器的全屏元素 > body */
export function tooltipPortalTarget(
  trigger: Element | null,
  explicit?: HTMLElement | null
): HTMLElement {
  if (explicit) return explicit;
  const fullscreen = document.fullscreenElement;
  if (fullscreen instanceof HTMLElement && trigger && fullscreen.contains(trigger)) {
    return fullscreen;
  }
  return document.body;
}

type TooltipPlacement = 'top' | 'bottom';

const VIEWPORT_PADDING = 8;
const TOOLTIP_GAP = 6;

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  delay = 300,
  className,
  style,
  portalContainer,
}) => {
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

  useEffect(() => {
    // 组件在指针下方挂载 / 重新挂载（例如弹窗内容异步加载完成后重渲染）时不会收到 mouseenter，
    // 这里主动检测一次悬停状态，避免提示一直不出现
    if (triggerRef.current?.matches(':hover')) show();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [show]);

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
    <span
      ref={triggerRef}
      className={className ? `${styles.wrapper} ${className}` : styles.wrapper}
      style={style}
      onMouseEnter={show}
      onMouseLeave={hide}
      // 点击后隐藏：触发器打开的弹层 / 菜单不会被提示遮住
      onMouseDown={hide}
    >
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
          tooltipPortalTarget(triggerRef.current, portalContainer)
        )}
    </span>
  );
};

export default Tooltip;
