import fs from 'fs-extra';
import path from 'path';

// 类型定义
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// 自定义文件扫描函数 (主进程版本)
export async function scanDirectory(dirPath: string): Promise<FileNode[]> {
  const supportedExtensions = [
    'txt',
    'md',
    'markdown',
    'mdown',
    'js',
    'ts',
    'jsx',
    'tsx',
    'json',
    'css',
    'scss',
    'html',
    'py',
    'java',
    'cpp',
    'c',
    'go',
    'rs',
    'php',
    'rb',
    'swift',
    'kt',
    'dart',
    'log',
    'rst',
    'adoc',
  ];

  const excludePatterns = ['node_modules', '.git', '.vscode', 'dist', 'build', 'out'];

  try {
    const items = await fs.readdir(dirPath);
    const fileNodes: FileNode[] = [];

    for (const item of items) {
      // 跳过排除的目录
      if (excludePatterns.includes(item)) continue;

      const fullPath = path.join(dirPath, item);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        // 递归扫描子目录
        const children = await scanDirectory(fullPath);
        if (children.length > 0) {
          fileNodes.push({
            name: item,
            path: fullPath,
            type: 'directory',
            children,
          });
        }
      } else if (stats.isFile()) {
        // 检查文件扩展名
        const ext = path.extname(item).toLowerCase().slice(1);
        if (supportedExtensions.includes(ext)) {
          fileNodes.push({
            name: item,
            path: fullPath,
            type: 'file',
          });
        }
      }
    }

    return fileNodes.sort((a, b) => {
      // 目录在前，文件在后，然后按名称排序
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error('Error scanning directory:', error);
    return [];
  }
}
