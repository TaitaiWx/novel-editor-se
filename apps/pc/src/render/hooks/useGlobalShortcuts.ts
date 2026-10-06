import React from 'react';
import { cleanupKeyboardShortcuts } from '@/render/components/ShortcutsHelp/shortcuts/cleanupKeyboardShortcuts';
import { initKeyboardShortcuts } from '@/render/components/ShortcutsHelp/shortcuts/initKeyboardShortcuts';
import { isImeComposing } from '@/render/utils/ime';
import { matchShortcutEvent } from '@/render/utils/appSettings';
import type { TabsState } from './state/useTabsState';
import type { LayoutState } from './state/useLayoutState';
import type { SettingsState } from './state/useSettingsState';
import type { TabActions } from './useTabActions';
import type { EditorInteractions } from './useEditorInteractions';
import type { ProjectLoaderApi } from './useProjectLoader';
import type { PaneLayoutApi } from './usePaneLayout';
import type { GrowthEntryApi } from './useGrowthEntry';

export type UseGlobalShortcutsContext = Pick<TabsState, 'activeTabRef'> &
  Pick<LayoutState, 'sidebarFocusedRef' | 'sidebarRef'> &
  Pick<SettingsState, 'appSettings'> &
  Pick<TabActions, 'closeTab' | 'handleNewTab' | 'toggleFocusMode'> &
  Pick<EditorInteractions, 'handleFormatCurrentChapter'> &
  Pick<ProjectLoaderApi, 'handleOpenLocal'> &
  Pick<PaneLayoutApi, 'handleToggleSidebar'> &
  Pick<GrowthEntryApi, 'handleOpenGrowth'>;

/**
 * 全局快捷键、菜单事件与默认拖放拦截
 */
export function useGlobalShortcuts(ctx: UseGlobalShortcutsContext) {
  const {
    activeTabRef,
    appSettings,
    closeTab,
    handleFormatCurrentChapter,
    handleNewTab,
    handleOpenGrowth,
    handleOpenLocal,
    handleToggleSidebar,
    sidebarFocusedRef,
    sidebarRef,
    toggleFocusMode,
  } = ctx;

  // Keyboard shortcuts
  React.useEffect(() => {
    initKeyboardShortcuts();
    // 菜单「文件 → 新建文件」与 Cmd/Ctrl+N 行为一致：新建未命名标签（VS Code 同款）
    const onNewFile = () => handleNewTab();
    const onOpenFolder = () => handleOpenLocal();
    const onKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      // 以下按键在渲染进程处理并 preventDefault，Electron 不会再触发同键的菜单加速键（不会重复执行）
      // Cmd+Q: 退出应用（渲染进程兜底，确保 Menu accelerator 失效时仍可退出）
      if (mod && e.key === 'q') {
        e.preventDefault();
        window.electron?.ipcRenderer?.invoke('app-quit');
        return;
      }
      if (matchShortcutEvent(e, appSettings.shortcuts.toggleSidebar)) {
        e.preventDefault();
        handleToggleSidebar();
        return;
      }
      if (e.key === 'F11' || matchShortcutEvent(e, appSettings.shortcuts.toggleFocusMode)) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (matchShortcutEvent(e, appSettings.shortcuts.closeTab)) {
        e.preventDefault();
        if (activeTabRef.current) {
          closeTab(activeTabRef.current);
        }
        return;
      }
      if (matchShortcutEvent(e, appSettings.shortcuts.formatChapter)) {
        e.preventDefault();
        handleFormatCurrentChapter();
        return;
      }
      if (matchShortcutEvent(e, appSettings.shortcuts.openGrowth)) {
        e.preventDefault();
        handleOpenGrowth(null);
        return;
      }
      // Cmd+N: 新建标签
      if (mod && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        handleNewTab();
      }
    };

    window.addEventListener('app:new-file', onNewFile);
    window.addEventListener('app:open-folder', onOpenFolder);
    window.addEventListener('keydown', onKeyDown);

    // 侧边栏焦点跟踪：鼠标按下时记录是否在侧边栏范围内（VS Code 同款方案）
    const onMouseDown = (e: MouseEvent) => {
      sidebarFocusedRef.current = !!sidebarRef.current?.contains(e.target as Node);
    };
    document.addEventListener('mousedown', onMouseDown);

    // 阻止 Electron 默认的文件拖放行为（拖入文件时浏览器会导航到该文件）
    const preventDefaultDrag = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragover', preventDefaultDrag);
    document.addEventListener('drop', preventDefaultDrag);

    return () => {
      cleanupKeyboardShortcuts();
      window.removeEventListener('app:new-file', onNewFile);
      window.removeEventListener('app:open-folder', onOpenFolder);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('dragover', preventDefaultDrag);
      document.removeEventListener('drop', preventDefaultDrag);
    };
  }, [
    activeTabRef,
    appSettings.shortcuts,
    closeTab,
    handleFormatCurrentChapter,
    handleNewTab,
    handleOpenGrowth,
    handleOpenLocal,
    handleToggleSidebar,
    sidebarFocusedRef,
    sidebarRef,
    toggleFocusMode,
  ]);
}
