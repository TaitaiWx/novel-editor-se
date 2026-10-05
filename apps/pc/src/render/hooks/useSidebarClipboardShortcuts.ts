import React from 'react';
import { findNodeInTree } from '@/render/app/fileTreeUtils';
import { isImeComposing } from '@/render/utils/ime';
import type { AppState } from './useAppState';
import type { FileOperations } from './useFileOperations';

export type UseSidebarClipboardShortcutsContext = Pick<
  AppState,
  'activeTabRef' | 'clipboard' | 'filesRef' | 'folderPathRef' | 'setClipboard' | 'sidebarFocusedRef'
> &
  Pick<FileOperations, 'handlePasteFiles'>;

/**
 * 侧边栏聚焦时的 Cmd+C / Cmd+V 文件复制粘贴
 */
export function useSidebarClipboardShortcuts(ctx: UseSidebarClipboardShortcutsContext) {
  const {
    activeTabRef,
    clipboard,
    filesRef,
    folderPathRef,
    handlePasteFiles,
    setClipboard,
    sidebarFocusedRef,
  } = ctx;

  // 侧边栏 Cmd+C/V 快捷键（独立 effect，确保 clipboard 最新值始终可用）
  React.useEffect(() => {
    /** 判断当前焦点是否在文本编辑区（输入框 / CodeMirror / contenteditable） */
    const isEditingText = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toUpperCase();
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        el.getAttribute('contenteditable') === 'true' ||
        !!el.closest('.cm-editor')
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (!sidebarFocusedRef.current) return;
      if (isEditingText()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === 'c') {
        // 复制：仅对真实文件路径（排除 __untitled__、__changelog__ 等虚拟路径）
        const tab = activeTabRef.current;
        if (tab && !tab.startsWith('__')) {
          e.preventDefault();
          setClipboard([tab]);
        }
      } else if (e.key === 'v') {
        // 粘贴：优先应用内剪贴板，其次系统剪贴板（Finder 复制的文件）
        e.preventDefault();
        const tab = activeTabRef.current;
        let targetDir = folderPathRef.current;
        if (tab && !tab.startsWith('__') && tab.includes('/')) {
          const node = findNodeInTree(filesRef.current, tab);
          if (node?.type === 'directory') {
            targetDir = tab;
          } else {
            targetDir = tab.substring(0, tab.lastIndexOf('/'));
          }
        }
        if (targetDir) handlePasteFiles(targetDir);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clipboard, handlePasteFiles]);
}
