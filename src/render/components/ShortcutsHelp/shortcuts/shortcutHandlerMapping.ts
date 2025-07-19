import { handleNewFile, handleOpenFolder, handleSaveFile, handleSaveAsFile } from './file';
import type { MappingType } from '../types';

/**
 * 快捷键处理器映射
 */
export const shortcutHandlerMapping: MappingType = {
  'shortcut-new-file': handleNewFile,
  'shortcut-open-folder': handleOpenFolder,
  'shortcut-save-file': handleSaveFile,
  'shortcut-save-as-file': handleSaveAsFile,
};
