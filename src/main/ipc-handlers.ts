import { ipcMain, dialog } from 'electron';
import dirTree from 'directory-tree';
import { readFile } from 'fs/promises';

// 类型定义
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// 转换目录树结构
function convertTreeFormat(node: dirTree.DirectoryTree): FileNode {
  return {
    name: node.name,
    path: node.path,
    type: node.type === 'directory' ? 'directory' : 'file',
    ...(node?.children && { children: node?.children?.map(convertTreeFormat) }),
  };
}

// 设置IPC通信处理程序
export function setupIPC() {
  // 打开本地文件夹
  ipcMain.handle('open-local-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要打开的文件夹',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      const tree = dirTree(folderPath, {
        exclude: /node_modules|\.git|\.vscode|dist|build|out/,
        attributes: ['type'],
        extensions:
          /\.(txt|md|js|ts|jsx|tsx|json|css|scss|html|py|java|cpp|c|go|rs|php|rb|swift|kt|dart)$/i,
      });

      return {
        path: folderPath,
        files: tree?.children ? tree?.children?.map(convertTreeFormat) : [],
      };
    }
    return null;
  });

  // 读取文件内容
  ipcMain.handle('read-file', async (event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      console.error('Error reading file:', error);
      throw new Error(`Failed to read file: ${filePath}`);
    }
  });

  // 获取文件信息
  ipcMain.handle('get-file-info', async (event, filePath: string) => {
    try {
      const { stat } = await import('fs/promises');
      const stats = await stat(filePath);

      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch (error) {
      console.error('Error getting file info:', error);
      throw new Error(`Failed to get file info: ${filePath}`);
    }
  });
}
