interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface OpenLocalResult {
  path: string;
  files: FileNode[];
}

interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
}

declare interface Window {
  electron: {
    ipcRenderer: {
      invoke(channel: 'open-local-folder'): Promise<OpenLocalResult | null>;
      invoke(channel: 'read-file', filePath: string): Promise<string>;
      invoke(
        channel: 'write-file',
        filePath: string,
        content: string
      ): Promise<{ success: boolean }>;
      invoke(channel: 'get-file-info', filePath: string): Promise<FileInfo>;
      invoke(channel: 'get-default-data-path'): Promise<string>;
      invoke(
        channel: 'create-file',
        folderPath: string,
        fileName: string
      ): Promise<{ success: boolean; filePath: string }>;
      invoke(
        channel: 'create-directory',
        folderPath: string,
        dirName: string
      ): Promise<{ success: boolean; dirPath: string }>;
      invoke(channel: 'refresh-folder', folderPath: string): Promise<OpenLocalResult>;
      invoke(channel: 'window-minimize'): Promise<void>;
      invoke(channel: 'window-maximize'): Promise<void>;
      invoke(channel: 'window-close'): Promise<void>;
      invoke(channel: 'window-is-maximized'): Promise<boolean>;
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    };
  };
}
