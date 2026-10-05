import { useRef, useEffect } from 'react';

/**
 * 渲染进程就绪 / 健康上报：首屏渲染后通知主进程（只上报一次）
 */
export function useRendererReadyReporting() {
  const hasReportedRendererReadyRef = useRef(false);
  const hasReportedRendererHealthReadyRef = useRef(false);

  useEffect(() => {
    if (hasReportedRendererReadyRef.current) return;
    hasReportedRendererReadyRef.current = true;
    window.electron?.ipcRenderer?.invoke('app-renderer-ready').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (hasReportedRendererHealthReadyRef.current) return;
    hasReportedRendererHealthReadyRef.current = true;

    let cancelled = false;
    let idleId: number | null = null;
    let raf1 = 0;
    let raf2 = 0;
    let timeoutId: number | null = null;

    const reportRendererHealth = () => {
      if (cancelled) return;
      window.electron?.ipcRenderer?.invoke('app-renderer-health-ready').catch(() => undefined);
    };

    const scheduleFallback = () => {
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(reportRendererHealth);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(reportRendererHealth, { timeout: 3000 });
      timeoutId = window.setTimeout(scheduleFallback, 3200);
    } else {
      scheduleFallback();
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);
}
