import { shortcutConfigs } from './config';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Cmd' : 'Ctrl';

/**
 * 分组的快捷键配置，用于展示
 * category 用于前端分组显示
 */
interface ShortcutDisplay {
  accelerator: string;
  description: string;
  category: '文件' | '编辑' | '视图' | '应用';
}

/**
 * 获取所有快捷键配置用于显示
 *
 * 合并主进程快捷键（Menu accelerator）和渲染进程快捷键（keydown / CM6）。
 * 过滤掉仅开发模式可用的快捷键（如刷新页面）。
 */
export const getAllShortcuts = (): ShortcutDisplay[] => {
  // 主进程快捷键（排除仅开发模式的项）
  const mainShortcuts: ShortcutDisplay[] = shortcutConfigs
    .filter((c) => !c.description.includes('开发模式'))
    .map((config) => ({
      accelerator: config.accelerator,
      description: config.description,
      category: categorize(config.description),
    }));

  // 渲染进程快捷键
  const rendererShortcuts: ShortcutDisplay[] = [
    // 文件操作
    { accelerator: `${mod}+S`, description: '保存文件', category: '文件' },
    { accelerator: `${mod}+Shift+S`, description: '另存为', category: '文件' },
    { accelerator: `${mod}+W`, description: '关闭当前标签', category: '文件' },
    { accelerator: `${mod}+Shift+W`, description: '导出为 Word', category: '文件' },
    { accelerator: `${mod}+Shift+P`, description: '导出为 PPT', category: '文件' },
    // 编辑
    { accelerator: `${mod}+Z`, description: '撤销', category: '编辑' },
    { accelerator: `${mod}+Shift+Z`, description: '重做', category: '编辑' },
    { accelerator: `${mod}+F`, description: '查找', category: '编辑' },
    { accelerator: `${mod}+H`, description: '查找替换', category: '编辑' },
    // 视图
    { accelerator: `${mod}+B`, description: '切换侧边栏', category: '视图' },
    { accelerator: `${mod}+Shift+F`, description: '切换专注模式', category: '视图' },
    { accelerator: 'F11', description: '切换专注模式', category: '视图' },
  ];

  return [...mainShortcuts, ...rendererShortcuts];
};

/** 根据描述自动归类 */
function categorize(description: string): ShortcutDisplay['category'] {
  if (/退出|最小化/.test(description)) return '应用';
  if (/新建|打开|保存/.test(description)) return '文件';
  if (/开发者|工具|侧边|聚焦|专注/.test(description)) return '视图';
  return '编辑';
}
