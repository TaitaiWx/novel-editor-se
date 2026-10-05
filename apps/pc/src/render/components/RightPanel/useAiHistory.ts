import { useState, useEffect, useCallback } from 'react';

// ─── History record ────────────────────────────────────────────────────────
export interface HistoryRecord {
  id: string;
  workflow: string;
  prompt: string;
  result: string;
  timestamp: number;
  /** File path that was open during analysis (for auto-fix fallback) */
  filePath?: string;
}

function createHistoryStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:ai-history:${folderPath}` : null;
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function useAiHistory(folderPath: string | null) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // ─── Load history from DB ────────────────────────────────────────────────
  useEffect(() => {
    // 切换项目时取消旧请求：迟到的旧项目结果不得覆盖新项目历史
    let cancelled = false;
    const load = async () => {
      const key = createHistoryStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) {
        setHistory([]);
        return;
      }
      let next: HistoryRecord[] = [];
      try {
        const raw = await ipc.invoke('db-settings-get', key);
        next = raw ? (JSON.parse(raw as string) as HistoryRecord[]) : [];
      } catch {
        next = [];
      }
      if (!cancelled) setHistory(next);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const persistHistory = useCallback(
    async (records: HistoryRecord[]) => {
      const key = createHistoryStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) return;
      // Keep last 50 records to avoid bloat
      const trimmed = records.slice(0, 50);
      await ipc.invoke('db-settings-set', key, JSON.stringify(trimmed));
    },
    [folderPath]
  );

  const addRecord = useCallback(
    (record: HistoryRecord) => {
      const next = [record, ...history];
      setHistory(next);
      setActiveHistoryId(record.id);
      void persistHistory(next);
    },
    [history, persistHistory]
  );

  const deleteRecord = useCallback(
    (id: string) => {
      const next = history.filter((r) => r.id !== id);
      setHistory(next);
      void persistHistory(next);
      if (activeHistoryId === id) {
        setActiveHistoryId(null);
      }
    },
    [history, persistHistory, activeHistoryId]
  );

  const toggleHistory = useCallback(() => {
    setShowHistory((prev) => !prev);
  }, []);

  return {
    history,
    activeHistoryId,
    setActiveHistoryId,
    showHistory,
    setShowHistory,
    toggleHistory,
    addRecord,
    deleteRecord,
  };
}
