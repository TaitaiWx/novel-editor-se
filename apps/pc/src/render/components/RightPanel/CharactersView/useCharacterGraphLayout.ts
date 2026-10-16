import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Character } from '../types';
import { createGraphLayoutStorageKey } from '../utils';

type Layout = Record<number, { x: number; y: number }>;

/** 节点、SVG 和拖拽统一使用 360 × 240 逻辑坐标，显示时转换为容器百分比。 */
export function useCharacterGraphLayout({
  folderPath,
  characters,
}: {
  folderPath: string | null;
  characters: Character[];
}) {
  const [graphLayout, setGraphLayout] = useState<Layout>({});
  const layoutRef = useRef(graphLayout);
  layoutRef.current = graphLayout;
  const cleanupDrag = useRef<() => void>();
  const dragged = useRef(false);
  const revision = useRef(0);
  const characterPositions = useMemo(
    () =>
      characters.map((character, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(characters.length, 1) - Math.PI / 2;
        const rows = Math.ceil(characters.length / 4);
        const fallback =
          characters.length === 1
            ? { x: 180, y: 120 }
            : characters.length > 8
              ? { x: ((index % 4) + 0.5) * 90, y: ((Math.floor(index / 4) + 0.5) * 240) / rows }
              : { x: 180 + Math.cos(angle) * 130, y: 120 + Math.sin(angle) * 78 };
        const saved = graphLayout[character.id];
        return {
          character,
          ...(saved &&
          Number.isFinite(saved.x) &&
          Number.isFinite(saved.y) &&
          saved.x >= 0 &&
          saved.x <= 360 &&
          saved.y >= 0 &&
          saved.y <= 240
            ? { x: saved.x, y: saved.y }
            : fallback),
        };
      }),
    [characters, graphLayout]
  );

  useEffect(() => {
    let cancelled = false;
    cleanupDrag.current?.();
    const loadRevision = ++revision.current;
    setGraphLayout({});
    const load = async () => {
      const key = createGraphLayoutStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) return;
      try {
        const raw = await ipc.invoke('db-settings-get', key);
        if (!cancelled && revision.current === loadRevision) {
          const value: unknown = raw ? JSON.parse(raw as string) : {};
          setGraphLayout(
            value && typeof value === 'object' && !Array.isArray(value) ? (value as Layout) : {}
          );
        }
      } catch {
        if (!cancelled && revision.current === loadRevision) setGraphLayout({});
      }
    };
    void load();
    return () => {
      cancelled = true;
      cleanupDrag.current?.();
    };
  }, [folderPath]);

  const persistGraphLayout = useCallback(
    async (next: Layout) => {
      const key = createGraphLayoutStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (key && ipc) await ipc.invoke('db-settings-set', key, JSON.stringify(next));
    },
    [folderPath]
  );

  const resetGraphLayout = useCallback(() => {
    cleanupDrag.current?.();
    revision.current += 1;
    layoutRef.current = {};
    setGraphLayout({});
    void persistGraphLayout({}).catch((error) => console.warn('人物图谱布局保存失败', error));
  }, [persistGraphLayout]);

  const handleGraphNodeMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, id: number) => {
      if (event.button !== 0) return;
      const parent = event.currentTarget.parentElement;
      const current = characterPositions.find((item) => item.character.id === id);
      if (!parent || !current) return;
      cleanupDrag.current?.();
      dragged.current = false;
      const rect = parent.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const marginX = ((event.currentTarget.offsetWidth / 2 + 24) * 360) / rect.width;
      const marginY = ((event.currentTarget.offsetHeight / 2 + 40) * 240) / rect.height;
      const onMove = (move: MouseEvent) => {
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        if (!dragged.current && Math.hypot(dx, dy) < 4) return;
        dragged.current = true;
        revision.current += 1;
        move.preventDefault();
        const x = Math.min(360 - marginX, Math.max(marginX, current.x + (dx * 360) / rect.width));
        const y = Math.min(240 - marginY, Math.max(marginY, current.y + (dy * 240) / rect.height));
        const next = { ...layoutRef.current, [id]: { x, y } };
        layoutRef.current = next;
        setGraphLayout(next);
      };
      const cleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', cleanup);
        cleanupDrag.current = undefined;
      };
      const onUp = () => {
        cleanup();
        if (dragged.current)
          void persistGraphLayout(layoutRef.current).catch((error) =>
            console.warn('人物图谱布局保存失败', error)
          );
      };
      cleanupDrag.current = cleanup;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('blur', cleanup);
    },
    [characterPositions, persistGraphLayout]
  );

  const consumeGraphDrag = useCallback(() => {
    const wasDragged = dragged.current;
    dragged.current = false;
    return wasDragged;
  }, []);
  return { characterPositions, handleGraphNodeMouseDown, resetGraphLayout, consumeGraphDrag };
}
