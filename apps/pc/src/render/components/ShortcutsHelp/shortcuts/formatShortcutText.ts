/**
 * 格式化快捷键显示文本
 */
export const formatShortcutText = (accelerator: string): string => {
  return accelerator
    .replace(/Cmd/g, '⌘')
    .replace(/Ctrl/g, 'Ctrl')
    .replace(/Alt/g, 'Alt')
    .replace(/Shift/g, 'Shift')
    .replace(/\+/g, ' + ');
};
