import { shortcutConfigs } from './config';

/**
 * 获取所有快捷键配置用于显示
 */
export const getAllShortcuts = (): { accelerator: string; description: string }[] => {
  return shortcutConfigs.map((config) => ({
    accelerator: config.accelerator,
    description: config.description,
  }));
};
