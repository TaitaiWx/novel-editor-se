import { useCallback, useEffect, useRef, useState } from 'react';
import type { VolumeOutline } from '@novel-editor/basic-algorithm';
import { createPlotStorageKey } from '../utils';
import {
  EMPTY_VOLUME_PLAN,
  createVolumePlanStorageKey,
  migrateLegacyPlotBoards,
  parseVolumePlanState,
  type VolumePlanState,
} from './volumePlanState';

const PERSIST_DELAY_MS = 400;

/**
 * 卷纲覆盖层的读写：按卷保存在 settings 表，修改后防抖写入（切换卷 / 卸载时立即写入）
 * 该卷还没有卷纲数据时，尝试从旧版剧情板迁移（需要推导结果按幕标题匹配）
 */
export function useVolumePlanState({
  volumePath,
  workPath,
  markerOutline,
}: {
  volumePath: string | null;
  workPath: string | null;
  /** 按正文幕标记推导的结果，用于旧版剧情板迁移；没有章节时为 null */
  markerOutline: VolumeOutline | null;
}) {
  const [state, setState] = useState<VolumePlanState>(EMPTY_VOLUME_PLAN);
  const [loaded, setLoaded] = useState(false);
  const [legacyRaw, setLegacyRaw] = useState<string | null>(null);
  const storageKey = createVolumePlanStorageKey(volumePath);
  const pendingRef = useRef<{ key: string; value: VolumePlanState } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    const ipc = window.electron?.ipcRenderer;
    if (!pending || !ipc) return;
    void ipc.invoke('db-settings-set', pending.key, JSON.stringify(pending.value));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLegacyRaw(null);
    setState(EMPTY_VOLUME_PLAN);
    const ipc = window.electron?.ipcRenderer;
    if (!storageKey || !ipc) {
      setLoaded(true);
      return;
    }
    void (async () => {
      try {
        const raw = await ipc.invoke('db-settings-get', storageKey);
        if (cancelled) return;
        const parsed = raw ? parseVolumePlanState(raw) : null;
        if (parsed) {
          setState(parsed);
        } else {
          const legacyKey = createPlotStorageKey(workPath);
          const legacy = legacyKey ? await ipc.invoke('db-settings-get', legacyKey) : null;
          if (!cancelled && typeof legacy === 'string' && legacy) setLegacyRaw(legacy);
        }
      } catch {
        // 读取失败时按空卷纲处理，不影响自动推导
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      flush();
    };
  }, [flush, storageKey, workPath]);

  const update = useCallback(
    (updater: (prev: VolumePlanState) => VolumePlanState) => {
      setState((prev) => {
        const next = updater(prev);
        if (next !== prev && storageKey) {
          pendingRef.current = { key: storageKey, value: next };
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(flush, PERSIST_DELAY_MS);
        }
        return next;
      });
    },
    [flush, storageKey]
  );

  // 旧版剧情板 → 卷纲（只迁移一次：迁移后该卷就有了自己的卷纲数据）
  useEffect(() => {
    if (!legacyRaw || !markerOutline) return;
    setLegacyRaw(null);
    const migrated = migrateLegacyPlotBoards(legacyRaw, markerOutline);
    if (migrated) update((prev) => ({ ...prev, ...migrated }));
  }, [legacyRaw, markerOutline, update]);

  return { state, loaded, update, flush };
}
