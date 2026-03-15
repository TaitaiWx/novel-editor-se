/**
 * 格式化快捷键显示文本
 * macOS 使用符号（⌘ ⇧ ⌥ ⌃），其他平台使用文字
 */
export const formatShortcutText = (accelerator: string): string => {
  const isMac = navigator.platform.startsWith('Mac');
  if (isMac) {
    return accelerator
      .replace(/Cmd/g, '⌘')
      .replace(/Ctrl/g, '⌃')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/\+/g, '');
  }
  return accelerator.replace(/\+/g, ' + ');
};
