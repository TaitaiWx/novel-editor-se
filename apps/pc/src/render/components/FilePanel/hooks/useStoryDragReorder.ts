import type React from 'react';
import { useCallback, useState } from 'react';
import { resolveStoryDropMode } from '../utils';
import type { StoryDragState, StoryDropMode, StoryDropTarget } from '../types';

/** 正文树内部拖拽排序：维护拖拽源与落点的瞬时状态，落下时回调上层持久化 */
export function useStoryDragReorder(
  onReorderStoryNode?: (sourcePath: string, targetPath: string, mode: StoryDropMode) => void
) {
  const [storyDragState, setStoryDragState] = useState<StoryDragState | null>(null);
  const [storyDropTarget, setStoryDropTarget] = useState<StoryDropTarget | null>(null);

  const handleStoryDragStart = useCallback(
    (event: React.DragEvent, sourcePath: string, parentPath: string) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', sourcePath);
      // 中文说明：拖拽期间只在面板内保留瞬时反馈，真实顺序仍以上层持久化映射为准。
      setStoryDragState({ sourcePath, parentPath });
      setStoryDropTarget(null);
    },
    []
  );

  const handleStoryDragOver = useCallback(
    (event: React.DragEvent, targetPath: string, parentPath: string, allowsInside: boolean) => {
      if (
        !storyDragState ||
        storyDragState.sourcePath === targetPath ||
        (!allowsInside && storyDragState.parentPath !== parentPath)
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const nextMode = resolveStoryDropMode(
        (event.currentTarget as HTMLElement).getBoundingClientRect(),
        event.clientY,
        allowsInside
      );
      if (
        !storyDropTarget ||
        storyDropTarget.path !== targetPath ||
        storyDropTarget.mode !== nextMode
      ) {
        setStoryDropTarget({ path: targetPath, mode: nextMode });
      }
    },
    [storyDragState, storyDropTarget]
  );

  const handleStoryDrop = useCallback(
    (event: React.DragEvent, targetPath: string, parentPath: string, mode: StoryDropMode) => {
      if (
        !storyDragState ||
        storyDragState.sourcePath === targetPath ||
        (mode !== 'inside' && storyDragState.parentPath !== parentPath)
      ) {
        return;
      }
      event.preventDefault();
      onReorderStoryNode?.(storyDragState.sourcePath, targetPath, mode);
      setStoryDragState(null);
      setStoryDropTarget(null);
    },
    [onReorderStoryNode, storyDragState]
  );

  const handleStoryDragEnd = useCallback(() => {
    setStoryDragState(null);
    setStoryDropTarget(null);
  }, []);

  return {
    storyDropTarget,
    handleStoryDragStart,
    handleStoryDragOver,
    handleStoryDrop,
    handleStoryDragEnd,
  };
}
