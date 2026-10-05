import { useEffect, useState } from 'react';
import type { StoryIdeaOutputType } from '@/render/types/electron-api';
import {
  createOutputFilterKey,
  createPoolSourceFilterKey,
  type StoryIdeaOutputFilterState,
} from './helpers';

/**
 * 词池来源筛选与候选结果筛选：按作品目录记住上次选择，下次打开沿用。
 */
export function useStoryIdeaFilterPersistence(folderPath: string | null) {
  const [poolSourceFilter, setPoolSourceFilter] = useState<'all' | 'history' | 'ai' | 'manual'>(
    'all'
  );
  const [poolSourceFilterLoaded, setPoolSourceFilterLoaded] = useState(false);
  const [outputTypeFilter, setOutputTypeFilter] = useState<'all' | StoryIdeaOutputType>('all');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [outputFilterLoaded, setOutputFilterLoaded] = useState(false);

  useEffect(() => {
    const key = createPoolSourceFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!key || !ipc) {
      setPoolSourceFilter('all');
      setPoolSourceFilterLoaded(true);
      return;
    }

    let cancelled = false;
    void ipc
      .invoke('db-settings-get', key)
      .then((raw) => {
        if (cancelled) return;
        if (raw === 'history' || raw === 'ai' || raw === 'manual' || raw === 'all') {
          setPoolSourceFilter(raw);
        } else {
          setPoolSourceFilter('all');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPoolSourceFilter('all');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPoolSourceFilterLoaded(true);
        }
      });

    return () => {
      cancelled = true;
      setPoolSourceFilterLoaded(false);
    };
  }, [folderPath]);

  useEffect(() => {
    const key = createPoolSourceFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!poolSourceFilterLoaded || !key || !ipc) return;
    void ipc.invoke('db-settings-set', key, poolSourceFilter).catch(() => undefined);
  }, [folderPath, poolSourceFilter, poolSourceFilterLoaded]);

  useEffect(() => {
    const key = createOutputFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!key || !ipc) {
      setOutputTypeFilter('all');
      setSelectedOnly(false);
      setOutputFilterLoaded(true);
      return;
    }

    let cancelled = false;
    void ipc
      .invoke('db-settings-get', key)
      .then((raw) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(String(raw || '')) as Partial<StoryIdeaOutputFilterState>;
          const nextType =
            parsed.type === 'logline' ||
            parsed.type === 'scene_hook' ||
            parsed.type === 'outline_direction'
              ? parsed.type
              : 'all';
          setOutputTypeFilter(nextType);
          setSelectedOnly(Boolean(parsed.selectedOnly));
        } catch {
          setOutputTypeFilter('all');
          setSelectedOnly(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOutputTypeFilter('all');
          setSelectedOnly(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOutputFilterLoaded(true);
        }
      });

    return () => {
      cancelled = true;
      setOutputFilterLoaded(false);
    };
  }, [folderPath]);

  useEffect(() => {
    const key = createOutputFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!outputFilterLoaded || !key || !ipc) return;
    const payload: StoryIdeaOutputFilterState = {
      type: outputTypeFilter,
      selectedOnly,
    };
    void ipc.invoke('db-settings-set', key, JSON.stringify(payload)).catch(() => undefined);
  }, [folderPath, outputFilterLoaded, outputTypeFilter, selectedOnly]);

  return {
    poolSourceFilter,
    setPoolSourceFilter,
    outputTypeFilter,
    setOutputTypeFilter,
    selectedOnly,
    setSelectedOnly,
  };
}
