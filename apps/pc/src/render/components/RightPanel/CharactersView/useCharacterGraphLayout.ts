import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Character } from '../types';
import { createGraphLayoutStorageKey } from '../utils';

/**
 * 人物关系图布局：默认环形排布 + 用户拖拽后的持久化坐标。
 */
export function useCharacterGraphLayout({
  folderPath,
  characters,
}: {
  folderPath: string | null;
  characters: Character[];
}) {
  const [graphLayout, setGraphLayout] = useState<Record<number, { x: number; y: number }>>({});
  const graphDraggingRef = useRef<{
    id: number;
    offsetX: number;
    offsetY: number;
    rect: DOMRect;
  } | null>(null);

  const defaultCharacterPositions = useMemo(() => {
    const centerX = 180;
    const centerY = 118;
    const radiusX = 118;
    const radiusY = 78;
    return characters.map((character, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(characters.length, 1) - Math.PI / 2;
      return {
        character,
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      };
    });
  }, [characters]);
  const characterPositions = useMemo(
    () =>
      defaultCharacterPositions.map((item) => {
        const saved = graphLayout[item.character.id];
        return saved ? { ...item, x: saved.x, y: saved.y } : item;
      }),
    [defaultCharacterPositions, graphLayout]
  );

  useEffect(() => {
    // 切换项目时取消旧请求，避免较晚返回的旧项目布局覆盖新项目
    let cancelled = false;
    const loadLayout = async () => {
      const key = createGraphLayoutStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) {
        setGraphLayout({});
        return;
      }
      try {
        const raw = await ipc.invoke('db-settings-get', key);
        if (cancelled) return;
        setGraphLayout(
          raw ? (JSON.parse(raw as string) as Record<number, { x: number; y: number }>) : {}
        );
      } catch {
        if (cancelled) return;
        setGraphLayout({});
      }
    };
    loadLayout();
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const persistGraphLayout = useCallback(
    async (nextLayout: Record<number, { x: number; y: number }>) => {
      const key = createGraphLayoutStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) return;
      await ipc.invoke('db-settings-set', key, JSON.stringify(nextLayout));
    },
    [folderPath]
  );

  const handleGraphNodeMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, id: number) => {
      const parent = (event.currentTarget.parentElement as HTMLElement) || null;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const current = characterPositions.find((item) => item.character.id === id);
      if (!current) return;
      graphDraggingRef.current = {
        id,
        offsetX: event.clientX - (rect.left + current.x),
        offsetY: event.clientY - (rect.top + current.y),
        rect,
      };
      const onMouseMove = (moveEvent: MouseEvent) => {
        const dragging = graphDraggingRef.current;
        if (!dragging || dragging.id !== id) return;
        const x = Math.min(
          Math.max(28, moveEvent.clientX - dragging.rect.left - dragging.offsetX),
          dragging.rect.width - 28
        );
        const y = Math.min(
          Math.max(24, moveEvent.clientY - dragging.rect.top - dragging.offsetY),
          dragging.rect.height - 24
        );
        setGraphLayout((prev) => ({ ...prev, [id]: { x, y } }));
      };
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        graphDraggingRef.current = null;
        setGraphLayout((prev) => {
          void persistGraphLayout(prev);
          return prev;
        });
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [characterPositions, persistGraphLayout]
  );

  return { characterPositions, handleGraphNodeMouseDown };
}
