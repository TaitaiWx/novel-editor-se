import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { EditorViewportSnapshot } from '../types';
import { useSyncedRef } from './useSyncedRef';

interface UseViewportSnapshotsOptions {
  viewRef: React.MutableRefObject<EditorView | null>;
  currentFilePathRef: React.MutableRefObject<string | null>;
  viewportSnapshots?: Record<string, EditorViewportSnapshot>;
  onViewportSnapshotChange?: (filePath: string, snapshot: EditorViewportSnapshot) => void;
}

/** 按文件记录 / 恢复光标与滚动位置，切换文件时保持阅读位置 */
export function useViewportSnapshots({
  viewRef,
  currentFilePathRef,
  viewportSnapshots,
  onViewportSnapshotChange,
}: UseViewportSnapshotsOptions) {
  const viewportSnapshotsRef = useRef<Map<string, EditorViewportSnapshot>>(new Map());
  const onViewportSnapshotChangeRef = useSyncedRef(onViewportSnapshotChange);

  useEffect(() => {
    viewportSnapshotsRef.current = new Map(Object.entries(viewportSnapshots || {}));
  }, [viewportSnapshots]);

  const saveViewportSnapshot = useCallback(
    (targetPath?: string | null) => {
      const view = viewRef.current;
      const snapshotPath = targetPath ?? currentFilePathRef.current;
      if (!view || !snapshotPath) return;

      const snapshot = {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
      };
      viewportSnapshotsRef.current.set(snapshotPath, snapshot);
      onViewportSnapshotChangeRef.current?.(snapshotPath, snapshot);
    },
    [currentFilePathRef, onViewportSnapshotChangeRef, viewRef]
  );

  const restoreViewportSnapshot = useCallback(
    (targetPath: string, contentLength: number) => {
      const view = viewRef.current;
      if (!view) return;

      const snapshot = viewportSnapshotsRef.current.get(targetPath);
      if (!snapshot) {
        view.dispatch({ selection: EditorSelection.cursor(0) });
        view.scrollDOM.scrollTop = 0;
        view.scrollDOM.scrollLeft = 0;
        return;
      }

      const anchor = Math.min(snapshot.anchor, contentLength);
      const head = Math.min(snapshot.head, contentLength);
      view.dispatch({ selection: EditorSelection.range(anchor, head) });
      window.requestAnimationFrame(() => {
        const activeView = viewRef.current;
        if (!activeView) return;
        activeView.scrollDOM.scrollTop = snapshot.scrollTop;
        activeView.scrollDOM.scrollLeft = snapshot.scrollLeft;
      });
    },
    [viewRef]
  );

  return { saveViewportSnapshot, restoreViewportSnapshot };
}
