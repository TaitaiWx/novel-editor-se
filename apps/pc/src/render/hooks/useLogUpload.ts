import { useCallback, useEffect, useRef, useState } from 'react';
import { describeLogUploadResult, type LogUploadResult } from '../../shared/log-upload';

export type LogUploadPhase = 'idle' | 'running' | 'done';

export interface LogUploadApi {
  phase: LogUploadPhase;
  result: LogUploadResult | null;
  /** 结果文案（上传成功 / 已打包到下载目录 / 失败原因） */
  message: string | null;
  run: () => Promise<void>;
}

/** 关于窗口「上传日志」：调用主进程打包并上传，未配置地址或失败时由主进程保存到「下载」目录 */
export function useLogUpload(): LogUploadApi {
  const [phase, setPhase] = useState<LogUploadPhase>('idle');
  const [result, setResult] = useState<LogUploadResult | null>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || runningRef.current) return;
    runningRef.current = true;
    setPhase('running');
    setResult(null);
    let next: LogUploadResult;
    try {
      next = await ipc.invoke('log-upload-run');
    } catch (error) {
      next = { status: 'failed', error: error instanceof Error ? error.message : '未知错误' };
    }
    runningRef.current = false;
    if (!mountedRef.current) return;
    setResult(next);
    setPhase('done');
  }, []);

  return { phase, result, message: result ? describeLogUploadResult(result) : null, run };
}
