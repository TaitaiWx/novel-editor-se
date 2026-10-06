import { useCallback, useEffect, useState } from 'react';
import { GROWTH_TOUR_STEPS, GROWTH_TOUR_STORAGE_KEY } from './growthGuide';

function readDone(): boolean {
  try {
    return window.localStorage.getItem(GROWTH_TOUR_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function markDone(): void {
  try {
    window.localStorage.setItem(GROWTH_TOUR_STORAGE_KEY, '1');
  } catch {
    // 存储不可用时只在本次会话内生效
  }
}

/**
 * 首次引导：第一次打开成长卡时自动显示，看完或跳过后记在 localStorage，
 * 之后只能从「使用说明 → 重新查看引导」再次打开。
 */
export function useGrowthTour(autoStart: boolean) {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (autoStart && !readDone()) setStep(0);
  }, [autoStart]);

  const close = useCallback(() => {
    markDone();
    setStep(null);
  }, []);

  const next = useCallback(() => {
    setStep((current) => {
      if (current === null) return null;
      if (current + 1 >= GROWTH_TOUR_STEPS.length) {
        markDone();
        return null;
      }
      return current + 1;
    });
  }, []);

  const prev = useCallback(() => {
    setStep((current) => (current === null ? null : Math.max(0, current - 1)));
  }, []);

  const start = useCallback(() => setStep(0), []);

  return { step, start, next, prev, close };
}
