import { useEffect } from 'react';
import type { UiState } from './state/useUiState';

/** 渲染进程内打开「关于」对话框的自定义事件（状态栏版本面板等使用） */
export const OPEN_ABOUT_DIALOG_EVENT = 'open-about-dialog';

/** 在任意组件中请求打开「关于」对话框 */
export function requestOpenAboutDialog(): void {
  window.dispatchEvent(new Event(OPEN_ABOUT_DIALOG_EVENT));
}

export type UseAboutDialogListenerContext = Pick<UiState, 'setShowAboutDialog'>;

/**
 * 监听打开「关于」对话框的请求：
 * - 主进程应用菜单（macOS「关于 小说编辑器」、Windows/Linux 帮助菜单）发送的 menu-open-about
 * - 渲染进程内的 open-about-dialog 自定义事件
 */
export function useAboutDialogListener(ctx: UseAboutDialogListenerContext) {
  const { setShowAboutDialog } = ctx;

  useEffect(() => {
    const open = () => setShowAboutDialog(true);
    window.addEventListener(OPEN_ABOUT_DIALOG_EVENT, open);
    const dispose = window.electron?.ipcRenderer?.on('menu-open-about', open);
    return () => {
      window.removeEventListener(OPEN_ABOUT_DIALOG_EVENT, open);
      dispose?.();
    };
  }, [setShowAboutDialog]);
}
