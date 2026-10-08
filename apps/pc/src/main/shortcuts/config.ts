import { app } from 'electron';

import { devToolsAllowed } from '../devtools-policy';
import type { MenuCommandId, ShortcutConfig } from './types';

/**
 * 应用菜单中带加速键的命令（展示格式）。
 *
 * - 菜单模板（menuTemplate.ts）按 id 取加速键，快捷键总览（getAllShortcuts.ts）展示同一份数据，
 *   保证「菜单显示的键 = 总览列出的键 = 实际生效的键」
 * - 渲染进程也处理的按键（Cmd+N / Cmd+S / Cmd+F / Cmd+Z / Cmd+Q）在渲染进程 keydown / CodeMirror keymap 中
 *   preventDefault，Electron 只把渲染进程未处理的按键交给菜单，因此不会重复触发；
 *   焦点不在编辑器时由菜单兜底
 * - 可在设置中心自定义的快捷键（切换侧边栏 / 专注写作）不在这里，由渲染进程通过 menu-sync-shortcuts 同步
 */
export const getShortcutConfigs = (): ShortcutConfig[] => {
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 'Cmd' : 'Ctrl';
  const configs: ShortcutConfig[] = [
    // 应用
    { id: 'quit', accelerator: `${mod}+Q`, description: '退出应用', category: '应用' },
    { id: 'settings', accelerator: `${mod}+,`, description: '打开设置', category: '应用' },
    ...(isMac
      ? ([
          { id: 'hide', accelerator: 'Cmd+H', description: '隐藏应用', category: '应用' },
          { id: 'hideOthers', accelerator: 'Cmd+Alt+H', description: '隐藏其他', category: '应用' },
        ] satisfies ShortcutConfig[])
      : []),
    { id: 'minimize', accelerator: `${mod}+M`, description: '最小化窗口', category: '应用' },

    // 文件
    { id: 'newFile', accelerator: `${mod}+N`, description: '新建文件', category: '文件' },
    { id: 'openFolder', accelerator: `${mod}+O`, description: '打开文件夹', category: '文件' },
    { id: 'save', accelerator: `${mod}+S`, description: '保存文件', category: '文件' },
    { id: 'saveAs', accelerator: `${mod}+Shift+S`, description: '另存为', category: '文件' },
    {
      id: 'exportProject',
      accelerator: `${mod}+Shift+E`,
      description: '导出项目',
      category: '文件',
    },

    // 编辑（撤销 / 重做由 CodeMirror 处理，菜单项使用原生 role）
    { id: 'undo', accelerator: `${mod}+Z`, description: '撤销', category: '编辑' },
    { id: 'redo', accelerator: `${mod}+Shift+Z`, description: '重做', category: '编辑' },
    { id: 'find', accelerator: `${mod}+F`, description: '查找', category: '编辑' },
    // 场景视频：渲染进程（useSceneVideoEntry）同样处理并 preventDefault，焦点不在编辑器时由菜单兜底
    {
      id: 'openSceneVideo',
      accelerator: `${mod}+Alt+V`,
      description: '场景视频',
      category: '编辑',
    },

    // 视图
    { id: 'zoomIn', accelerator: `${mod}+=`, description: '放大', category: '视图' },
    { id: 'zoomOut', accelerator: `${mod}+-`, description: '缩小', category: '视图' },
    { id: 'resetZoom', accelerator: `${mod}+0`, description: '实际大小', category: '视图' },
    // Windows / Linux 的 F11 已用于专注模式，切换全屏只保留菜单项不设加速键
    ...(isMac
      ? ([
          {
            id: 'toggleFullscreen',
            accelerator: 'Ctrl+Cmd+F',
            description: '切换全屏',
            category: '视图',
          },
        ] satisfies ShortcutConfig[])
      : []),
  ];

  if (!app.isPackaged) {
    configs.push({
      id: 'reload',
      accelerator: `${mod}+R`,
      description: '重新加载（开发模式）',
      category: '视图',
      devOnly: true,
    });
  }
  // 生产版本没有开发者工具入口（菜单 / 快捷键 / IPC 都不提供，见 devtools-policy.ts）
  if (devToolsAllowed()) {
    configs.push({
      id: 'toggleDevTools',
      accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
      description: '切换开发者工具',
      category: '视图',
      devOnly: true,
    });
  }
  return configs;
};

/** 展示格式 → Electron 加速键（Cmd / Ctrl 统一为 CommandOrControl；Ctrl+Cmd 组合保留 Control） */
export const toElectronAccelerator = (accelerator: string): string => {
  if (/Ctrl\+Cmd\+/.test(accelerator)) {
    return accelerator.replace('Ctrl+Cmd+', 'Control+Command+');
  }
  return accelerator.replace(/\b(Cmd|Ctrl)\+/g, 'CommandOrControl+');
};

/** 按命令 id 取菜单加速键；当前平台没有该快捷键时返回 undefined */
export const getMenuAccelerator = (
  configs: ShortcutConfig[],
  id: MenuCommandId
): string | undefined => {
  const config = configs.find((item) => item.id === id);
  return config ? toElectronAccelerator(config.accelerator) : undefined;
};
