import { shortcutConfigs } from './config';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Cmd' : 'Ctrl';

/**
 * 渲染进程直接处理的快捷键（不注册为 Menu accelerator，仅展示）
 */
const rendererShortcuts: { accelerator: string; description: string }[] = [
  { accelerator: `${mod}+S`, description: '保存文件' },
  { accelerator: `${mod}+W`, description: '关闭当前标签' },
  { accelerator: `${mod}+B`, description: '切换侧边栏' },
  { accelerator: `${mod}+Shift+F`, description: '切换聚焦模式' },
  { accelerator: 'F11', description: '切换聚焦模式' },
];

/**
 * 获取所有快捷键配置用于显示（包含主进程和渲染进程）
 */
export const getAllShortcuts = (): { accelerator: string; description: string }[] => {
  const mainShortcuts = shortcutConfigs.map((config) => ({
    accelerator: config.accelerator,
    description: config.description,
  }));
  return [...mainShortcuts, ...rendererShortcuts];
};
