import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { isExternalFileDrag } from '../utils';

/**
 * 拖放导入（VS Code 风格: Finder/Explorer → 文件面板）。
 * 用计数器抵消子元素间移动产生的 dragenter/dragleave 抖动。
 */
export function useExternalFileDrop(onDropFiles?: (filePaths: string[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const droppedFiles = e.dataTransfer.files;
      if (droppedFiles.length === 0) return;
      // preload 在 capture 阶段已提取 File.path，直接取回
      const filePaths = window.electron?.getLastDroppedPaths() || [];
      if (filePaths.length > 0) onDropFiles?.(filePaths);
    },
    [onDropFiles]
  );

  return { isDragOver, handleDragOver, handleDragEnter, handleDragLeave, handleDrop };
}
