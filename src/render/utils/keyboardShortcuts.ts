/**
 * 键盘快捷键映射和处理工具 (渲染进程)
 * 主要用于显示快捷键信息，实际的快捷键注册在主进程中
 */

export interface ShortcutInfo {
  accelerator: string;
  description: string;
}

export class KeyboardShortcutManager {
  private shortcuts: ShortcutInfo[] = [];
  private isLoaded = false;

  constructor() {
    this.loadShortcuts();
  }

  /**
   * 从主进程加载快捷键列表
   */
  private async loadShortcuts() {
    try {
      if (window.electron?.ipcRenderer) {
        this.shortcuts = await window.electron.ipcRenderer.invoke('get-shortcuts');
        this.isLoaded = true;
      }
    } catch (error) {
      console.error('Failed to load shortcuts:', error);
    }
  }

  /**
   * 获取所有快捷键
   */
  async getAllShortcuts(): Promise<ShortcutInfo[]> {
    if (!this.isLoaded) {
      await this.loadShortcuts();
    }
    return this.shortcuts;
  }

  /**
   * 格式化快捷键显示文本
   */
  formatShortcutText(accelerator: string): string {
    // 将 Electron 的快捷键格式转换为显示格式
    return accelerator
      .replace(/Cmd/g, '⌘')
      .replace(/Ctrl/g, 'Ctrl')
      .replace(/Alt/g, 'Alt')
      .replace(/Shift/g, 'Shift')
      .replace(/\+/g, ' + ');
  }

  /**
   * 重新加载快捷键列表
   */
  async reload() {
    this.isLoaded = false;
    await this.loadShortcuts();
  }
}

// 创建全局实例
export const keyboardShortcutManager = new KeyboardShortcutManager();

// 监听快捷键事件（从主进程发送的）
export const initKeyboardShortcuts = () => {
  if (window.electron?.ipcRenderer) {
    // 监听来自主进程的快捷键事件
    window.electron.ipcRenderer.on('shortcut-new-file', () => {
      // 可以在这里触发新建文件的UI操作
      console.log('新建文件快捷键触发');
    });

    window.electron.ipcRenderer.on('shortcut-open-folder', () => {
      // 可以在这里触发打开文件夹的UI操作
      console.log('打开文件夹快捷键触发');
    });

    window.electron.ipcRenderer.on('shortcut-save-file', () => {
      // 可以在这里触发保存文件的UI操作
      console.log('保存文件快捷键触发');
    });

    window.electron.ipcRenderer.on('shortcut-save-as-file', () => {
      // 可以在这里触发另存为的UI操作
      console.log('另存为快捷键触发');
    });
  }
};

// 清理监听（在组件卸载时）
export const cleanupKeyboardShortcuts = () => {
  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.removeAllListeners('shortcut-new-file');
    window.electron.ipcRenderer.removeAllListeners('shortcut-open-folder');
    window.electron.ipcRenderer.removeAllListeners('shortcut-save-file');
    window.electron.ipcRenderer.removeAllListeners('shortcut-save-as-file');
  }
};
