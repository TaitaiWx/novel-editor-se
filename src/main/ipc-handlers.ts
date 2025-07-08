import { ipcMain, dialog } from 'electron';
import dirTree from 'directory-tree';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import path from 'path';

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

  // 写入文件内容
  ipcMain.handle('write-file', async (event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      throw new Error(`Failed to write file: ${filePath}`);
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

  // 获取默认数据目录
  ipcMain.handle('get-default-data-path', async () => {
    try {
      // 获取当前工作目录
      const currentDir = process.cwd();
      const dataPath = path.join(currentDir, 'data');

      // 如果data目录不存在，创建它
      try {
        await access(dataPath);
      } catch {
        await mkdir(dataPath, { recursive: true });
      }

      return dataPath;
    } catch (error) {
      console.error('Error creating/getting data path:', error);
      throw new Error('Failed to get default data path');
    }
  });

  // 创建新文件
  ipcMain.handle('create-file', async (event, folderPath: string, fileName: string) => {
    try {
      const filePath = path.join(folderPath, fileName);

      // 检查文件是否已存在
      try {
        await access(filePath);
        throw new Error('文件已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // 创建空文件
      await writeFile(filePath, '', 'utf-8');

      return { success: true, filePath };
    } catch (error) {
      console.error('Error creating file:', error);
      throw new Error(
        `Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // 创建新目录
  ipcMain.handle('create-directory', async (event, folderPath: string, dirName: string) => {
    try {
      const dirPath = path.join(folderPath, dirName);

      // 检查目录是否已存在
      try {
        await access(dirPath);
        throw new Error('目录已存在');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // 创建目录
      await mkdir(dirPath, { recursive: true });

      return { success: true, dirPath };
    } catch (error) {
      console.error('Error creating directory:', error);
      throw new Error(
        `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  // 刷新文件夹内容
  ipcMain.handle('refresh-folder', async (event, folderPath: string) => {
    try {
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
    } catch (error) {
      console.error('Error refreshing folder:', error);
      throw new Error(`Failed to refresh folder: ${folderPath}`);
    }
  });
}
