// 文件事件类型定义
export enum FileEventType {
  FILE_SELECTED = 'FILE_SELECTED', // 文件被选中
  FILE_LOADING = 'FILE_LOADING', // 文件开始加载
  FILE_LOADED = 'FILE_LOADED', // 文件加载完成
  FILE_LOAD_ERROR = 'FILE_LOAD_ERROR', // 文件加载失败
  FILE_CHANGED = 'FILE_CHANGED', // 文件内容变化
}

// 文件事件数据结构
export interface FileEvent {
  type: FileEventType;
  filePath: string | null;
  content?: string;
  error?: string;
  timestamp: number;
}

// 文件状态枚举
export enum FileState {
  NONE = 'NONE',
  SELECTED = 'SELECTED',
  LOADING = 'LOADING',
  LOADED = 'LOADED',
  ERROR = 'ERROR',
}
