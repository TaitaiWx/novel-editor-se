import React, { useCallback } from 'react';
import type { EditorViewportSnapshot } from '@/render/components/TextEditor';
import type { FileNode } from '@/render/types';
import type { PersistedEditorSession } from '@/render/app/types';
import {
  findNodeInTree,
  isChangelogTabPath,
  isUntitledTabPath,
  remapWorkspaceTabPath,
  replacePathPrefix,
} from '@/render/app/fileTreeUtils';
import { parseEditorSessionSnapshot, sameViewportSnapshot } from '@/render/app/editorSession';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { EditorState } from './state/useEditorState';

export type UseEditorSessionContext = Pick<WorkspaceState, 'files' | 'filesRef'> &
  Pick<
    TabsState,
    'activeTab' | 'activeTabRef' | 'openTabs' | 'openTabsRef' | 'setActiveTab' | 'setOpenTabs'
  > &
  Pick<
    EditorState,
    | 'editorSessionHydratedRef'
    | 'editorSessionKey'
    | 'editorViewportSnapshotsRef'
    | 'persistEditorSessionTimerRef'
    | 'restoredEditorSessionKeyRef'
    | 'setInitialViewportSnapshots'
  >;

/**
 * 编辑器会话（打开的标签、活动标签、视口快照）的恢复与持久化
 */
export function useEditorSession(ctx: UseEditorSessionContext) {
  const {
    activeTab,
    activeTabRef,
    editorSessionHydratedRef,
    editorSessionKey,
    editorViewportSnapshotsRef,
    files,
    filesRef,
    openTabs,
    openTabsRef,
    persistEditorSessionTimerRef,
    restoredEditorSessionKeyRef,
    setActiveTab,
    setInitialViewportSnapshots,
    setOpenTabs,
  } = ctx;

  const syncInitialViewportSnapshots = useCallback(
    (next: Record<string, EditorViewportSnapshot>) => {
      editorViewportSnapshotsRef.current = next;
      setInitialViewportSnapshots(next);
    },
    []
  );

  const isPersistableTabPath = useCallback((path: string | null, nodes: FileNode[]): boolean => {
    if (!path || isUntitledTabPath(path)) return false;
    if (isChangelogTabPath(path)) return true;
    const node = findNodeInTree(nodes, path);
    return node?.type === 'file';
  }, []);

  const schedulePersistEditorSession = useCallback(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !editorSessionKey || !editorSessionHydratedRef.current) return;

    const persistedActiveTab = isPersistableTabPath(activeTabRef.current, filesRef.current)
      ? activeTabRef.current
      : null;
    const persistedOpenTabs = openTabsRef.current.filter((path) =>
      isPersistableTabPath(path, filesRef.current)
    );
    const nextOpenTabs = persistedActiveTab
      ? Array.from(new Set([...persistedOpenTabs, persistedActiveTab]))
      : persistedOpenTabs;
    const viewportSnapshots = Object.fromEntries(
      Object.entries(editorViewportSnapshotsRef.current).filter(([path]) =>
        isPersistableTabPath(path, filesRef.current)
      )
    ) as Record<string, EditorViewportSnapshot>;
    const nextSession: PersistedEditorSession = {
      openTabs: nextOpenTabs,
      activeTab: persistedActiveTab,
      viewportSnapshots,
    };

    if (persistEditorSessionTimerRef.current) {
      window.clearTimeout(persistEditorSessionTimerRef.current);
    }
    persistEditorSessionTimerRef.current = window.setTimeout(() => {
      ipc.invoke('db-settings-set', editorSessionKey, JSON.stringify(nextSession)).catch(() => {});
    }, 180);
  }, [editorSessionKey, isPersistableTabPath]);

  const remapPathReferences = useCallback(
    (oldPath: string, newPath: string) => {
      if (oldPath === newPath) return;

      setOpenTabs((prev) =>
        Array.from(new Set(prev.map((tabPath) => remapWorkspaceTabPath(tabPath, oldPath, newPath))))
      );

      const nextActiveTab = remapWorkspaceTabPath(activeTabRef.current || '', oldPath, newPath);
      if (activeTabRef.current && nextActiveTab !== activeTabRef.current) {
        setActiveTab(nextActiveTab);
      }

      const currentSnapshots = editorViewportSnapshotsRef.current;
      let changed = false;
      const nextSnapshots = Object.fromEntries(
        Object.entries(currentSnapshots).map(([path, snapshot]) => {
          const nextPath = replacePathPrefix(path, oldPath, newPath);
          if (nextPath !== path) changed = true;
          return [nextPath, snapshot];
        })
      ) as Record<string, EditorViewportSnapshot>;

      if (changed) {
        syncInitialViewportSnapshots(nextSnapshots);
        schedulePersistEditorSession();
      }
    },
    [schedulePersistEditorSession, syncInitialViewportSnapshots]
  );

  const moveViewportSnapshot = useCallback(
    (fromPath: string, toPath: string) => {
      if (fromPath === toPath) return;
      const current = editorViewportSnapshotsRef.current;
      const snapshot = current[fromPath];
      if (!snapshot) return;
      const next = { ...current, [toPath]: snapshot };
      delete next[fromPath];
      syncInitialViewportSnapshots(next);
      schedulePersistEditorSession();
    },
    [schedulePersistEditorSession, syncInitialViewportSnapshots]
  );

  const removeViewportSnapshots = useCallback(
    (predicate: (path: string) => boolean) => {
      const current = editorViewportSnapshotsRef.current;
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(current).filter(([path, snapshot]) => {
          const keep = !predicate(path);
          if (!keep) changed = true;
          return keep && Boolean(snapshot);
        })
      ) as Record<string, EditorViewportSnapshot>;
      if (changed) {
        syncInitialViewportSnapshots(next);
        schedulePersistEditorSession();
      }
    },
    [schedulePersistEditorSession, syncInitialViewportSnapshots]
  );

  const handleViewportSnapshotChange = useCallback(
    (filePath: string, snapshot: EditorViewportSnapshot) => {
      const previous = editorViewportSnapshotsRef.current[filePath];
      if (sameViewportSnapshot(previous, snapshot)) return;
      editorViewportSnapshotsRef.current = {
        ...editorViewportSnapshotsRef.current,
        [filePath]: snapshot,
      };
      schedulePersistEditorSession();
    },
    [schedulePersistEditorSession]
  );

  React.useEffect(() => {
    if (!editorSessionKey) {
      restoredEditorSessionKeyRef.current = null;
      editorSessionHydratedRef.current = false;
      syncInitialViewportSnapshots({});
      return;
    }

    restoredEditorSessionKeyRef.current = null;
    editorSessionHydratedRef.current = false;
    syncInitialViewportSnapshots({});
  }, [editorSessionKey, syncInitialViewportSnapshots]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !editorSessionKey) return;
    if (restoredEditorSessionKeyRef.current === editorSessionKey) return;

    let cancelled = false;
    const restoreEditorSession = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', editorSessionKey)) as string | null;
        if (cancelled) return;
        const parsed = parseEditorSessionSnapshot(raw);
        if (parsed) {
          const restoredOpenTabs = parsed.openTabs.filter((path) =>
            isPersistableTabPath(path, files)
          );
          const restoredActiveTab = isPersistableTabPath(parsed.activeTab, files)
            ? parsed.activeTab
            : null;
          const nextOpenTabs = restoredActiveTab
            ? Array.from(new Set([...restoredOpenTabs, restoredActiveTab]))
            : restoredOpenTabs;
          const nextViewportSnapshots = Object.fromEntries(
            Object.entries(parsed.viewportSnapshots).filter(([path]) =>
              isPersistableTabPath(path, files)
            )
          ) as Record<string, EditorViewportSnapshot>;

          syncInitialViewportSnapshots(nextViewportSnapshots);
          setOpenTabs(nextOpenTabs);
          setActiveTab(restoredActiveTab || nextOpenTabs[nextOpenTabs.length - 1] || null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          restoredEditorSessionKeyRef.current = editorSessionKey;
          editorSessionHydratedRef.current = true;
        }
      }
    };

    void restoreEditorSession();
    return () => {
      cancelled = true;
    };
  }, [editorSessionKey, files, isPersistableTabPath, syncInitialViewportSnapshots]);

  React.useEffect(() => {
    schedulePersistEditorSession();
  }, [openTabs, activeTab, schedulePersistEditorSession]);

  React.useEffect(() => {
    return () => {
      if (persistEditorSessionTimerRef.current) {
        window.clearTimeout(persistEditorSessionTimerRef.current);
      }
    };
  }, []);

  return {
    syncInitialViewportSnapshots,
    isPersistableTabPath,
    schedulePersistEditorSession,
    remapPathReferences,
    moveViewportSnapshot,
    removeViewportSnapshots,
    handleViewportSnapshotChange,
  };
}

export type EditorSessionApi = ReturnType<typeof useEditorSession>;
