/** 快捷键总览中的分组（与渲染进程 ShortcutsHelp 的 CATEGORY_ORDER 一致） */
export type ShortcutCategory = '文件' | '编辑' | '视图' | '应用';

/** 主进程菜单命令（每个 id 对应应用菜单中的一个可见菜单项） */
export type MenuCommandId =
  | 'quit'
  | 'settings'
  | 'hide'
  | 'hideOthers'
  | 'minimize'
  | 'newFile'
  | 'openFolder'
  | 'save'
  | 'saveAs'
  | 'exportProject'
  | 'undo'
  | 'redo'
  | 'find'
  | 'openSceneVideo'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'toggleFullscreen'
  | 'reload'
  | 'toggleDevTools';

export interface ShortcutConfig {
  id: MenuCommandId;
  /** 展示格式（Cmd+N / Ctrl+N），菜单加速键由 toElectronAccelerator 转换 */
  accelerator: string;
  description: string;
  category: ShortcutCategory;
  /** 仅开发模式（未打包）可用，不在快捷键总览中展示 */
  devOnly?: boolean;
}
