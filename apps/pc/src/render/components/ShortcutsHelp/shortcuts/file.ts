/**
 * 渲染进程文件操作快捷键处理
 * 通过 CustomEvent 分发给 App 组件处理
 */

export const handleNewFile = () => {
  window.dispatchEvent(new CustomEvent('app:new-file'));
};

export const handleOpenFolder = () => {
  window.dispatchEvent(new CustomEvent('app:open-folder'));
};

export const handleSaveFile = () => {
  window.dispatchEvent(new CustomEvent('app:save-file'));
};

export const handleSaveAsFile = () => {
  window.dispatchEvent(new CustomEvent('app:save-as-file'));
};
