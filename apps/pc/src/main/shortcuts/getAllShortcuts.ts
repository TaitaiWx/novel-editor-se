import { getShortcutConfigs } from './config';
import type { ShortcutCategory } from './types';

const isMac = () => process.platform === 'darwin';

/**
 * 快捷键总览的展示项；category 用于前端分组显示
 */
interface ShortcutDisplay {
  accelerator: string;
  description: string;
  category: ShortcutCategory;
}

/**
 * 获取所有快捷键配置用于显示（快捷键总览 ShortcutsHelp）
 *
 * 合并应用菜单快捷键（config.ts，与菜单项共用一份数据）和只在渲染进程处理的快捷键（keydown / CM6）。
 * 过滤掉仅开发模式可用的快捷键（如重新加载）。
 * 渲染进程条目的 description 与 appSettings.applyShortcutOverrides 的键一致，用户自定义后会被覆盖。
 */
export const getAllShortcuts = (): ShortcutDisplay[] => {
  const mod = isMac() ? 'Cmd' : 'Ctrl';

  const menuShortcuts: ShortcutDisplay[] = getShortcutConfigs()
    .filter((config) => !config.devOnly)
    .map(({ accelerator, description, category }) => ({ accelerator, description, category }));

  // 只在渲染进程处理的快捷键（其中「切换侧边栏」「切换专注模式」同时出现在视图菜单，加速键由渲染进程同步）
  const rendererShortcuts: ShortcutDisplay[] = [
    { accelerator: `${mod}+P`, description: '搜索文件', category: '文件' },
    { accelerator: `${mod}+W`, description: '关闭当前标签', category: '文件' },
    { accelerator: `${mod}+Alt+L`, description: '格式化当前章节', category: '编辑' },
    { accelerator: `${mod}+B`, description: '切换侧边栏', category: '视图' },
    { accelerator: `${mod}+Shift+F`, description: '切换专注模式', category: '视图' },
    { accelerator: 'F11', description: '切换专注模式', category: '视图' },
    { accelerator: `${mod}+Shift+J`, description: '打开成长档案', category: '视图' },
  ];

  return [...menuShortcuts, ...rendererShortcuts];
};
