import { app, BrowserWindow, globalShortcut } from 'electron';

export interface ShortcutConfig {
  accelerator: string;
  description: string;
  action: () => void;
}

export class ShortcutManager {
  private shortcuts: Map<string, ShortcutConfig> = new Map();

  constructor() {
    this.initDefaultShortcuts();
  }

  /**
   * 初始化默认快捷键
   */
  private initDefaultShortcuts() {
    const isMac = process.platform === 'darwin';

    // 关闭窗口 - Mac: Cmd+W, Windows/Linux: Ctrl+W
    this.register({
      accelerator: isMac ? 'Cmd+W' : 'Ctrl+W',
      description: '关闭当前窗口',
      action: this.closeWindow
    });

    // 退出应用 - Mac: Cmd+Q, Windows/Linux: Ctrl+Q
    this.register({
      accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q',
      description: '退出应用',
      action: this.quitApp
    });

    // 开发者工具 - 跨平台: Ctrl+Shift+I (Mac也用Ctrl)
    this.register({
      accelerator: 'Ctrl+Shift+I',
      description: '打开/关闭开发者工具',
      action: this.toggleDevTools
    });

    // 全屏切换 - 跨平台: F11
    this.register({
      accelerator: 'F11',
      description: '切换全屏模式',
      action: this.toggleFullscreen
    });

    // 最小化窗口 - Mac: Cmd+M, Windows/Linux: Ctrl+M
    this.register({
      accelerator: isMac ? 'Cmd+M' : 'Ctrl+M',
      description: '最小化窗口',
      action: this.minimizeWindow
    });

    // 新建文件 - Mac: Cmd+N, Windows/Linux: Ctrl+N
    this.register({
      accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
      description: '新建文件',
      action: this.newFile
    });

    // 打开文件夹 - Mac: Cmd+O, Windows/Linux: Ctrl+O
    this.register({
      accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
      description: '打开文件夹',
      action: this.openFolder
    });

    // 保存文件 - Mac: Cmd+S, Windows/Linux: Ctrl+S
    this.register({
      accelerator: isMac ? 'Cmd+S' : 'Ctrl+S',
      description: '保存当前文件',
      action: this.saveFile
    });

    // 另存为 - Mac: Cmd+Shift+S, Windows/Linux: Ctrl+Shift+S
    this.register({
      accelerator: isMac ? 'Cmd+Shift+S' : 'Ctrl+Shift+S',
      description: '另存为',
      action: this.saveAsFile
    });

    // 刷新 - Mac: Cmd+R, Windows/Linux: Ctrl+R (仅在开发模式)
    if (!app.isPackaged) {
      this.register({
        accelerator: isMac ? 'Cmd+R' : 'Ctrl+R',
        description: '刷新页面 (开发模式)',
        action: this.reloadWindow
      });
    }
  }

  /**
   * 注册快捷键
   */
  register(config: ShortcutConfig) {
    this.shortcuts.set(config.accelerator, config);
  }

  /**
   * 注销特定快捷键
   */
  unregister(accelerator: string) {
    this.shortcuts.delete(accelerator);
    globalShortcut.unregister(accelerator);
  }

  /**
   * 注册所有快捷键到系统
   */
  registerAll() {
    this.shortcuts.forEach((config, accelerator) => {
      const success = globalShortcut.register(accelerator, config.action);
      if (!success) {
        console.warn(`Failed to register shortcut: ${accelerator}`);
      } else {
        console.log(`Registered shortcut: ${accelerator} - ${config.description}`);
      }
    });
  }

  /**
   * 注销所有快捷键
   */
  unregisterAll() {
    globalShortcut.unregisterAll();
    console.log('All shortcuts unregistered');
  }

  /**
   * 获取所有快捷键配置
   */
  getAllShortcuts(): { accelerator: string; description: string }[] {
    return Array.from(this.shortcuts.entries()).map(([accelerator, config]) => ({
      accelerator,
      description: config.description
    }));
  }

  // 快捷键处理函数
  private closeWindow = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.close();
    }
  };

  private quitApp = () => {
    app.quit();
  };

  private toggleDevTools = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools();
      }
    }
  };

  private toggleFullscreen = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.setFullScreen(!window.isFullScreen());
    }
  };

  private minimizeWindow = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.minimize();
    }
  };

  private newFile = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('shortcut-new-file');
    }
  };

  private openFolder = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('shortcut-open-folder');
    }
  };

  private saveFile = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('shortcut-save-file');
    }
  };

  private saveAsFile = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.send('shortcut-save-as-file');
    }
  };

  private reloadWindow = () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.reload();
    }
  };
}

// 创建全局实例
export const shortcutManager = new ShortcutManager();
