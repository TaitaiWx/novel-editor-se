import { useCallback, useEffect, useRef, useState } from 'react';

/** 横向滚动容器两侧是否还有被遮住的内容 */
export interface HorizontalOverflowState {
  /** 左侧还有内容（已向右滚动过） */
  start: boolean;
  /** 右侧还有内容（未滚到底） */
  end: boolean;
}

/** 允许的像素误差，避免缩放下的小数宽度导致渐隐闪烁 */
const EPSILON = 1;

/** 根据滚动位置计算两侧是否溢出（纯函数，便于测试） */
export function computeHorizontalOverflow(metrics: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): HorizontalOverflowState {
  const { scrollLeft, scrollWidth, clientWidth } = metrics;
  if (scrollWidth - clientWidth <= EPSILON) return { start: false, end: false };
  return {
    start: scrollLeft > EPSILON,
    end: scrollLeft + clientWidth < scrollWidth - EPSILON,
  };
}

/**
 * 监听横向可滚动容器的溢出状态，用于在边缘显示渐隐提示。
 * 滚动、容器尺寸变化时重新计算；不支持 ResizeObserver 的环境退化为监听窗口 resize。
 */
export function useHorizontalOverflow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<HorizontalOverflowState>({ start: false, end: false });

  const update = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const next = computeHorizontalOverflow(element);
    setState((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    update();
    element.addEventListener('scroll', update, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(element);
    } else {
      window.addEventListener('resize', update);
    }
    return () => {
      element.removeEventListener('scroll', update);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, [update]);

  return { ref, overflow: state, update };
}
