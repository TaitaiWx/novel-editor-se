import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StoryIdeaCardRow } from '@/render/types/electron-api';
import {
  buildStoryIdeaTermPoolFromCards,
  createEmptyStoryIdeaTermPool,
  mergeStoryIdeaTermPool,
  parseStoryIdeaTermPool,
  serializeStoryIdeaTermPool,
  type StoryIdeaTermPoolState,
} from '../RightPanel/story-idea';
import {
  INSPIRATION_SLOT_SECTIONS,
  buildStoryIdeaCreatePayload,
  inspirationToStoryIdeaDraft,
  type InspirationDraw,
  type InspirationSlot,
} from './inspiration';

/** 与原三签卡共用的自定义词池 key（按作品目录） */
export function createInspirationTermPoolKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:story-idea-term-pool:${folderPath}` : null;
}

/**
 * 灵感抽签的持久化数据：历史（三签卡表）与我的词池（db-settings）。
 * 只在弹窗打开时加载；数据库未就绪时退化为纯内置词库，抽签照常可用。
 */
export function useInspirationData(folderPath: string | null, dbReady: boolean, active: boolean) {
  const [cards, setCards] = useState<StoryIdeaCardRow[]>([]);
  const [customPool, setCustomPool] = useState<StoryIdeaTermPoolState>(
    createEmptyStoryIdeaTermPool()
  );

  const loadCards = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath || !dbReady) {
      setCards([]);
      return;
    }
    try {
      const rows = (await ipc.invoke('db-story-idea-card-list-by-folder', folderPath)) as
        | StoryIdeaCardRow[]
        | null;
      setCards(Array.isArray(rows) ? rows : []);
    } catch {
      setCards([]);
    }
  }, [dbReady, folderPath]);

  const loadCustomPool = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const key = createInspirationTermPoolKey(folderPath);
    if (!ipc || !key) {
      setCustomPool(createEmptyStoryIdeaTermPool());
      return;
    }
    try {
      const raw = (await ipc.invoke('db-settings-get', key)) as string | null;
      setCustomPool(parseStoryIdeaTermPool(raw));
    } catch {
      setCustomPool(createEmptyStoryIdeaTermPool());
    }
  }, [folderPath]);

  useEffect(() => {
    if (!active) return;
    void loadCards();
    void loadCustomPool();
  }, [active, loadCards, loadCustomPool]);

  const termPool = useMemo(
    () => mergeStoryIdeaTermPool(buildStoryIdeaTermPoolFromCards(cards), customPool),
    [cards, customPool]
  );

  /** 把一个词加入「我的词池」对应的那一签 */
  const addCustomTerm = useCallback(
    async (slot: InspirationSlot, term: string) => {
      const ipc = window.electron?.ipcRenderer;
      const key = createInspirationTermPoolKey(folderPath);
      const trimmed = term.trim();
      if (!ipc || !key || !trimmed) return false;
      const next = mergeStoryIdeaTermPool(customPool, {
        [INSPIRATION_SLOT_SECTIONS[slot]]: [{ term: trimmed, sources: ['manual'] }],
      });
      try {
        await ipc.invoke('db-settings-set', key, serializeStoryIdeaTermPool(next));
        setCustomPool(next);
        return true;
      } catch {
        return false;
      }
    },
    [customPool, folderPath]
  );

  /** 用过的抽签（插入 / 复制 / 扩写）存入历史；失败不影响主流程 */
  const saveToHistory = useCallback(
    async (draw: InspirationDraw) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !folderPath || !dbReady) return;
      try {
        await ipc.invoke(
          'db-story-idea-card-create-by-folder',
          folderPath,
          buildStoryIdeaCreatePayload(inspirationToStoryIdeaDraft(draw))
        );
        await loadCards();
      } catch {
        // 作品未入库等情况：历史只是锦上添花，静默跳过
      }
    },
    [dbReady, folderPath, loadCards]
  );

  return { cards, termPool, addCustomTerm, saveToHistory };
}

export type InspirationData = ReturnType<typeof useInspirationData>;
