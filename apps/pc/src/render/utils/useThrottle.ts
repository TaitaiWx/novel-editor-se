/**
 * useThrottle — 值节流 React Hook。
 *
 * 与 useDebounce 互补：debounce 等到输入停止后才更新，
 * throttle 保证间隔内至少输出一次（leading），且尾值不丢失（trailing）。
 *
 * 适用于需要"实时感"的场景：编辑内容同步、滚动位置同步、拖拽坐标广播。
 *
 * @example
 * const throttledContent = useThrottle(editorContent, 50); // ~20fps
 * useEffect(() => sendToPanel(throttledContent), [throttledContent]);
 */
import { useState, useEffect, useRef } from 'react';

export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastInvokeTime = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValue = useRef(value);

  useEffect(() => {
    latestValue.current = value;
    const now = Date.now();
    const elapsed = now - lastInvokeTime.current;

    if (elapsed >= interval) {
      // Leading edge：立即更新
      lastInvokeTime.current = now;
      setThrottledValue(value);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else if (!timerRef.current) {
      // Trailing edge：间隔结束后更新为最新值
      timerRef.current = setTimeout(() => {
        lastInvokeTime.current = Date.now();
        setThrottledValue(latestValue.current);
        timerRef.current = null;
      }, interval - elapsed);
    }
    // 间隔内且已有 timer：latestValue.current 已更新，timer 到期自动取最新值

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, interval]);

  return throttledValue;
}
