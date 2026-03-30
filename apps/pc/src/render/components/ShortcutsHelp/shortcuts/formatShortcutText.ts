/**
 * 格式化快捷键显示文本
 * macOS 使用符号（⌘ ⇧ ⌥ ⌃），其他平台使用文字
 */
export const formatShortcutText = (accelerator: string): string => {
  const isMac = navigator.platform.startsWith('Mac');
  const normalized = accelerator.replace(/CommandOrControl/g, isMac ? 'Cmd' : 'Ctrl');
  if (isMac) {
    return normalized
      .replace(/Mod/g, '⌘')
      .replace(/Cmd/g, '⌘')
      .replace(/Ctrl/g, '⌃')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/\+/g, '');
  }
  return normalized.replace(/Mod/g, 'Ctrl').replace(/\+/g, ' + ');
};
