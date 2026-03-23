/**
 * throttle — 通用节流函数。
 *
 * 默认 leading + trailing：首次调用立即执行，间隔内忽略后续调用，
 * 间隔结束后自动执行最后一次调用（保证尾值不丢失）。
 *
 * 适用于高频事件（滚动、拖拽、实时输入同步）。
 *
 * @example
 * const throttledSend = throttle((data: string) => port.postMessage(data), 50);
 * editor.on('change', throttledSend);
 * // 卸载时：throttledSend.cancel();
 */

export interface ThrottledFunction<T extends (...args: never[]) => unknown> {
  (...args: Parameters<T>): void;
  /** 取消待执行的 trailing 调用 */
  cancel(): void;
  /** 立即执行待处理的 trailing 调用（如有） */
  flush(): void;
}

export function throttle<T extends (...args: never[]) => unknown>(
  fn: T,
  interval: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): ThrottledFunction<T> {
  const { leading = true, trailing = true } = options;

  let lastInvokeTime = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  function invoke(args: Parameters<T>) {
    lastInvokeTime = Date.now();
    lastArgs = null;
    fn(...args);
  }

  function timerExpired() {
    timerId = null;
    if (trailing && lastArgs) {
      invoke(lastArgs);
    }
  }

  function throttled(...args: Parameters<T>) {
    const now = Date.now();
    const elapsed = now - lastInvokeTime;
    lastArgs = args;

    if (elapsed >= interval) {
      // 间隔已过：立即执行（leading）或标记时间戳等 trailing
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (leading) {
        invoke(args);
      } else {
        lastInvokeTime = now;
        timerId = setTimeout(timerExpired, interval);
      }
    } else if (!timerId) {
      // 间隔内首次后续调用：调度 trailing
      timerId = setTimeout(timerExpired, interval - elapsed);
    }
    // 间隔内且已有 timer：仅更新 lastArgs，timer 到期后自动取最新值
  }

  throttled.cancel = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    lastArgs = null;
    lastInvokeTime = 0;
  };

  throttled.flush = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (lastArgs) {
      invoke(lastArgs);
    }
  };

  return throttled as ThrottledFunction<T>;
}
