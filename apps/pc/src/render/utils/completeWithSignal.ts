import type { AICompletePayload } from '../types/ai-api';

/** 立即终止前端等待，同时取消主进程实际请求；迟到结果由 Promise.race 丢弃。 */
export async function completeWithSignal(payload: AICompletePayload, signal: AbortSignal) {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const request = window.electron.ipcRenderer.invoke('ai-complete', { ...payload, requestId });
  let abort: () => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      void window.electron.ipcRenderer
        .invoke('ai-complete-cancel', requestId)
        .catch(() => undefined);
      reject(new DOMException('已取消生成', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([request, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
