import { useCallback, useEffect, useRef } from 'react';
import { APP_MENU_EVENTS, CHANGELOG_TAB_PATH } from '../../shared/app-menu';
import { describeLogUploadResult } from '../../shared/log-upload';
import { getActiveEditor } from '@/render/components/TextEditor/active-editor';
import { requestOpenInspiration } from '@/render/components/InspirationDialog/inspiration';
import { isChangelogPath, isUntitledPath } from '@/render/components/TextEditor/editor-paths';
import {
  buildSaveAsDefaultName,
  describeManualUpdateCheck,
  splitFilePath,
  validateSaveAsName,
} from '@/render/utils/appMenu';
import type { UiState } from './state/useUiState';
import type { SettingsState } from './state/useSettingsState';
import type { PaneLayoutApi } from './usePaneLayout';
import type { TabActions } from './useTabActions';
import type { ProjectLoaderApi } from './useProjectLoader';
import type { FileOperations } from './useFileOperations';

export type UseAppMenuContext = Pick<
  UiState,
  'toast' | 'dialog' | 'setShowShortcuts' | 'setSettingsCenterTab' | 'setShowSettingsCenter'
> &
  Pick<SettingsState, 'appSettings'> &
  Pick<PaneLayoutApi, 'handleToggleSidebar' | 'handleToggleRightPanel'> &
  Pick<TabActions, 'toggleFocusMode' | 'openFileInTab'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'> &
  Pick<FileOperations, 'handleSaveUntitled'>;

/** 主进程「保存」「另存为」经 shortcut-save-file / shortcut-save-as-file 转成的窗口事件 */
export const APP_SAVE_FILE_EVENT = 'app:save-file';
export const APP_SAVE_AS_FILE_EVENT = 'app:save-as-file';

/**
 * 应用菜单（主进程 Menu）命令在渲染进程中的落地：
 * - 监听 APP_MENU_EVENTS（设置、检查更新、视图切换、查找、灵感抽签、快捷键说明、更新日志、上传日志）
 * - 处理「保存」「另存为」窗口事件（作用于最近聚焦的编辑器）
 * - 把设置中心自定义的「切换侧边栏」「专注写作」「灵感抽签」快捷键同步给主进程，保证菜单加速键与实际按键一致
 */
export function useAppMenu(ctx: UseAppMenuContext) {
  const {
    toast,
    dialog,
    setShowShortcuts,
    setSettingsCenterTab,
    setShowSettingsCenter,
    appSettings,
    handleToggleSidebar,
    handleToggleRightPanel,
    toggleFocusMode,
    openFileInTab,
    refreshCurrentFolder,
    handleSaveUntitled,
  } = ctx;
  const logUploadRunningRef = useRef(false);

  const handleCheckUpdates = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    toast.info('正在检查更新…');
    try {
      await ipc.invoke('update-check');
      const status = await ipc.invoke('update-status');
      const notice = describeManualUpdateCheck(status);
      toast[notice.type](notice.message);
    } catch (error) {
      toast.error(`检查更新失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [toast]);

  const handleUploadLogs = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || logUploadRunningRef.current) return;
    logUploadRunningRef.current = true;
    toast.info('正在打包日志…');
    try {
      const result = await ipc.invoke('log-upload-run');
      const message = describeLogUploadResult(result);
      if (result.status === 'uploaded') toast.success(message);
      else if (result.status === 'saved') toast.info(message);
      else toast.error(message);
    } catch (error) {
      toast.error(`日志打包失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      logUploadRunningRef.current = false;
    }
  }, [toast]);

  const handleSaveAs = useCallback(async () => {
    const editor = getActiveEditor();
    const snapshot = editor?.getSnapshot();
    if (!editor || !snapshot?.filePath || isChangelogPath(snapshot.filePath)) {
      toast.info('请先打开要另存为的文件');
      return;
    }
    const { filePath, content } = snapshot;
    if (isUntitledPath(filePath)) {
      await handleSaveUntitled(filePath, content);
      return;
    }
    const { dir, name, sep } = splitFilePath(filePath);
    const input = await dialog.prompt('另存为', '请输入新文件名', buildSaveAsDefaultName(name));
    if (input === null) return;
    const nextName = input.trim();
    const invalid = validateSaveAsName(nextName);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    const targetPath = dir ? `${dir}${sep}${nextName}` : nextName;
    if (targetPath === filePath) {
      editor.save();
      return;
    }
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    try {
      const existing = await ipc.invoke('get-file-info-batch', [targetPath]);
      if (existing.length > 0) {
        const overwrite = await dialog.confirm('文件已存在', `「${nextName}」已存在，是否覆盖？`);
        if (!overwrite) return;
      }
      await ipc.invoke('write-file', targetPath, content);
      await refreshCurrentFolder();
      openFileInTab(targetPath);
      toast.success(`已另存为「${nextName}」`);
    } catch (error) {
      toast.error(`另存为失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, handleSaveUntitled, openFileInTab, refreshCurrentFolder, toast]);

  // 主进程菜单事件
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const handlers: Record<string, () => void> = {
      [APP_MENU_EVENTS.openSettings]: () => {
        setSettingsCenterTab('general');
        setShowSettingsCenter(true);
      },
      [APP_MENU_EVENTS.checkUpdates]: () => void handleCheckUpdates(),
      [APP_MENU_EVENTS.toggleSidebar]: handleToggleSidebar,
      [APP_MENU_EVENTS.toggleRightPanel]: handleToggleRightPanel,
      [APP_MENU_EVENTS.toggleFocusMode]: toggleFocusMode,
      [APP_MENU_EVENTS.find]: () => {
        const editor = getActiveEditor();
        if (editor) editor.openSearch();
        else toast.info('请先打开一个文件');
      },
      [APP_MENU_EVENTS.openInspiration]: () => requestOpenInspiration(),
      [APP_MENU_EVENTS.showShortcuts]: () => setShowShortcuts(true),
      [APP_MENU_EVENTS.openChangelog]: () => openFileInTab(CHANGELOG_TAB_PATH),
      [APP_MENU_EVENTS.uploadLogs]: () => void handleUploadLogs(),
    };
    const disposers = Object.entries(handlers).map(([channel, handler]) =>
      ipc.on(channel, () => handler())
    );
    return () => {
      disposers.forEach((dispose) => dispose?.());
    };
  }, [
    handleCheckUpdates,
    handleToggleRightPanel,
    handleToggleSidebar,
    handleUploadLogs,
    openFileInTab,
    setSettingsCenterTab,
    setShowSettingsCenter,
    setShowShortcuts,
    toast,
    toggleFocusMode,
  ]);

  // 文件 → 保存 / 另存为（主进程 shortcut-save-file / shortcut-save-as-file 转成的窗口事件）
  useEffect(() => {
    const onSave = () => getActiveEditor()?.save();
    const onSaveAs = () => void handleSaveAs();
    window.addEventListener(APP_SAVE_FILE_EVENT, onSave);
    window.addEventListener(APP_SAVE_AS_FILE_EVENT, onSaveAs);
    return () => {
      window.removeEventListener(APP_SAVE_FILE_EVENT, onSave);
      window.removeEventListener(APP_SAVE_AS_FILE_EVENT, onSaveAs);
    };
  }, [handleSaveAs]);

  // 自定义快捷键同步到菜单加速键
  const { toggleSidebar, toggleFocusMode: focusShortcut, openInspiration } = appSettings.shortcuts;
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    void ipc
      .invoke('menu-sync-shortcuts', {
        toggleSidebar,
        toggleFocusMode: focusShortcut,
        openInspiration,
      })
      .catch(() => undefined);
  }, [toggleSidebar, focusShortcut, openInspiration]);
}
