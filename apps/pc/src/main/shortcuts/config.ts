import { app } from 'electron';

import { toggleDevTools } from './devtools';
import { ShortcutConfig } from './types';
import { newFile } from './newFile';
import { openFolder } from './openFolder';
import { quitApp } from './quitApp';
import { minimizeWindow } from './minimizeWindow';
import { reloadWindow } from './reloadWindow';

/**
 * 快捷键配置数组
 *
 * 注意: Cmd+S, Cmd+Shift+S, Cmd+W, F11 由渲染进程直接处理，
 * 不在此处注册，避免 Menu accelerator 拦截 keydown 事件。
 */
export const shortcutConfigs: ShortcutConfig[] = [
  // 窗口相关
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
    description: '退出应用',
    action: quitApp,
  },
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+M' : 'Ctrl+M',
    description: '最小化窗口',
    action: minimizeWindow,
  },

  // 开发者工具
  {
    accelerator: 'Ctrl+Shift+I',
    description: '打开/关闭开发者工具',
    action: toggleDevTools,
  },

  // 文件操作（Cmd+N, Cmd+O 通过 IPC 传递给渲染进程）
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+N' : 'Ctrl+N',
    description: '新建文件',
    action: newFile,
  },
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+O' : 'Ctrl+O',
    description: '打开文件夹',
    action: openFolder,
  },

  // 开发模式下的刷新
  ...(app.isPackaged
    ? []
    : [
        {
          accelerator: process.platform === 'darwin' ? 'Cmd+R' : 'Ctrl+R',
          description: '刷新页面 (开发模式)',
          action: reloadWindow,
        },
      ]),
];
