import { app } from 'electron';

import { toggleDevTools } from './devtools';
import { ShortcutConfig } from './types';
import { newFile } from './newFile';
import { openFolder } from './openFolder';
import { saveFile } from './saveFile';
import { saveAsFile } from './saveAsFile';
import { closeWindow } from './closeWindow';
import { quitApp } from './quitApp';
import { minimizeWindow } from './minimizeWindow';
import { toggleFullscreen } from './toggleFullscreen';
import { reloadWindow } from './reloadWindow';

/**
 * 快捷键配置数组
 */
export const shortcutConfigs: ShortcutConfig[] = [
  // 窗口相关
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+W' : 'Ctrl+W',
    description: '关闭当前窗口',
    action: closeWindow,
  },
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
    description: '退出应用',
    action: quitApp,
  },
  {
    accelerator: 'F11',
    description: '切换全屏模式',
    action: toggleFullscreen,
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

  // 文件操作
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
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+S' : 'Ctrl+S',
    description: '保存当前文件',
    action: saveFile,
  },
  {
    accelerator: process.platform === 'darwin' ? 'Cmd+Shift+S' : 'Ctrl+Shift+S',
    description: '另存为',
    action: saveAsFile,
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
