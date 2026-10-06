/**
 * API 相关的类型定义
 */

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

/** `ne init` 项目结构（core `readProjectLayout`），文件夹没有 .novel-editor/config.json 时为 null */
export interface WorkspaceProjectLayout {
  name: string;
  novelsDir: string;
  novelsPath: string;
  /** 作品名（novelsDir 下的作品目录，与 `ne novel list` 一致） */
  novels: string[];
}

export interface OpenLocalResult {
  path: string;
  files: FileNode[];
  project?: WorkspaceProjectLayout | null;
}

export interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileInfoBatchEntry {
  path: string;
  info: FileInfo;
}

export interface ShortcutInfo {
  accelerator: string;
  description: string;
  category?: '文件' | '编辑' | '视图' | '应用';
}
