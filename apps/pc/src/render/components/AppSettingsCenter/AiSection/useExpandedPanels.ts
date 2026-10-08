/**
 * AI 服务面板的展开 / 收起：作者点过的记在 localStorage（应用全局），
 * 没点过的按默认规则（已配置或默认写作 AI 展开，其余收起）
 */
import { useCallback, useState } from 'react';

export const AI_PANELS_STORAGE_KEY = 'novel-editor:ai-settings-expanded';

type ExpandedMap = Record<string, boolean>;

function readStored(): ExpandedMap {
  try {
    const raw = window.localStorage.getItem(AI_PANELS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: ExpandedMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeStored(map: ExpandedMap): void {
  try {
    window.localStorage.setItem(AI_PANELS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 存储不可用（隐私模式等）：只在本次会话记住
  }
}

export function useExpandedPanels() {
  const [stored, setStored] = useState<ExpandedMap>(readStored);

  const isExpanded = useCallback(
    (id: string, fallback: boolean) => (id in stored ? stored[id] : fallback),
    [stored]
  );

  const setExpanded = useCallback((id: string, expanded: boolean) => {
    setStored((prev) => {
      const next = { ...prev, [id]: expanded };
      writeStored(next);
      return next;
    });
  }, []);

  /** 删除服务时忘掉它的展开状态 */
  const forget = useCallback((id: string) => {
    setStored((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      writeStored(next);
      return next;
    });
  }, []);

  return { isExpanded, setExpanded, forget };
}
