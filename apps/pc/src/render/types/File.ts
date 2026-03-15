/**
 * API 相关的类型定义
 */

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface OpenLocalResult {
  path: string;
  files: FileNode[];
}

export interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
}

export interface ShortcutInfo {
  accelerator: string;
  description: string;
  category?: '文件' | '编辑' | '视图' | '应用';
}
