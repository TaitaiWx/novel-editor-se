import { useEffect, useMemo, useRef, useState } from 'react';
import type { GuiSessionSnapshot } from '@novel-editor/core/gui-session';
import { isPathInWorkspace, isUntitledTabPath } from '@/render/app/fileTreeUtils';
import {
  NOVEL_EDITOR_DIRTY_CHANGE_EVENT,
  type NovelEditorDirtyChangeDetail,
} from '@/render/utils/editor-events';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';

/** 状态变化后延迟发布，合并连续变化（如连续输入未命名标签） */
export const GUI_SESSION_PUBLISH_DEBOUNCE_MS = 500;
/** 心跳：定期刷新 updatedAt，CLI 据此判断会话是否过期（与 core GUI_SESSION_HEARTBEAT_MS 一致） */
export const GUI_SESSION_HEARTBEAT_MS = 60 * 1000;

export type UseGuiSessionPublisherContext = Pick<WorkspaceState, 'folderPath'> &
  Pick<TabsState, 'openTabs' | 'activeTab' | 'untitledTabContents'>;

/** 只上报真实文件（工作区内）与未命名标签，跳过人物/设定等工作区虚拟标签和更新日志 */
function isReportableTab(tabPath: string, folderPath: string): boolean {
  if (isUntitledTabPath(tabPath)) return true;
  if (tabPath.startsWith('__')) return false;
  return isPathInWorkspace(tabPath, folderPath);
}

export function buildGuiSessionSnapshot(
  folderPath: string,
  openTabs: string[],
  activeTab: string | null,
  untitledTabContents: Record<string, string>,
  dirtyFiles: ReadonlySet<string>
): GuiSessionSnapshot {
  const paths = Array.from(new Set([...openTabs, ...dirtyFiles])).filter((tabPath) =>
    isReportableTab(tabPath, folderPath)
  );
  return {
    workspaceRoot: folderPath,
    activeFile: activeTab && isReportableTab(activeTab, folderPath) ? activeTab : null,
    openFiles: paths.map((tabPath) => ({
      path: tabPath,
      // 未命名标签只要有内容就是未保存的修改
      dirty:
        dirtyFiles.has(tabPath) ||
        (isUntitledTabPath(tabPath) && Boolean(untitledTabContents[tabPath])),
    })),
  };
}

function publish(snapshot: GuiSessionSnapshot | null): void {
  window.electron?.ipcRenderer?.invoke('gui-session-publish', snapshot).catch(() => {});
}

/**
 * 把 GUI 会话（打开的标签、当前文件、未保存文件）发布到 <folder>/.novel-editor/session.json，
 * 供 CLI `ne status` 读取。状态变化防抖发布，并定期心跳刷新；关闭/切换文件夹时上报 null。
 */
export function useGuiSessionPublisher(ctx: UseGuiSessionPublisherContext): void {
  const { folderPath, openTabs, activeTab, untitledTabContents } = ctx;
  const [dirtyFiles, setDirtyFiles] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const handleDirtyChange = (event: Event) => {
      const { filePath, dirty } = (event as CustomEvent<NovelEditorDirtyChangeDetail>).detail;
      setDirtyFiles((prev) => {
        if (prev.has(filePath) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(filePath);
        else next.delete(filePath);
        return next;
      });
    };
    document.addEventListener(NOVEL_EDITOR_DIRTY_CHANGE_EVENT, handleDirtyChange);
    return () => document.removeEventListener(NOVEL_EDITOR_DIRTY_CHANGE_EVENT, handleDirtyChange);
  }, []);

  const snapshot = useMemo(
    () =>
      folderPath
        ? buildGuiSessionSnapshot(folderPath, openTabs, activeTab, untitledTabContents, dirtyFiles)
        : null,
    [folderPath, openTabs, activeTab, untitledTabContents, dirtyFiles]
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // 状态变化：防抖发布
  useEffect(() => {
    if (!snapshot) return;
    const timer = window.setTimeout(() => publish(snapshot), GUI_SESSION_PUBLISH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  // 打开文件夹期间心跳刷新；关闭或切换文件夹时通知主进程把旧会话标记为 closed
  useEffect(() => {
    if (!folderPath) return;
    const interval = window.setInterval(() => {
      if (snapshotRef.current) publish(snapshotRef.current);
    }, GUI_SESSION_HEARTBEAT_MS);
    return () => {
      window.clearInterval(interval);
      publish(null);
    };
  }, [folderPath]);
}
