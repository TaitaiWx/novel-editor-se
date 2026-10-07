import { useCallback, useEffect, useRef, useState } from 'react';
import type { GrowthSnapshot } from '@/render/types/growth-api';
import {
  GROWTH_MEMORY_CHANGED_EVENT,
  type GrowthMemoryChangedDetail,
} from '@/render/utils/growthIndex';

/**
 * 当前作品的完整成长档案快照（规则 + 成长卡），供人物悬停卡片显示等级 / 经验条。
 * 作品切换时读取；成长视图写入后（growth-memory-changed）与窗口重新获得焦点时刷新。
 */
export function useWorkGrowthSnapshot(workPath: string | null) {
  const [entry, setEntry] = useState<{ workPath: string; snapshot: GrowthSnapshot } | null>(null);
  const workRef = useRef(workPath);
  workRef.current = workPath;

  const reload = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!workPath || !ipc) {
      setEntry(null);
      return;
    }
    try {
      const result = await ipc.invoke('growth-load', workPath);
      if (workRef.current !== workPath) return;
      setEntry(result.ok ? { workPath, snapshot: result.data } : null);
    } catch {
      if (workRef.current === workPath) setEntry(null);
    }
  }, [workPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<GrowthMemoryChangedDetail>).detail;
      if (detail?.folderPath === workRef.current) void reload();
    };
    const onFocus = () => void reload();
    window.addEventListener(GROWTH_MEMORY_CHANGED_EVENT, onChanged);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(GROWTH_MEMORY_CHANGED_EVENT, onChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  return entry && entry.workPath === workPath ? entry.snapshot : null;
}
