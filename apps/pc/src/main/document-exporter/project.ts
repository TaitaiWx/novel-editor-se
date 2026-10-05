/** 项目导出：将整个文件夹下的 .md / .txt 合并导出为单个 Word */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { exportToWord } from './word';
import type { WordExportOptions } from './word';

/** 递归收集所有 .md / .txt 文件并按名称排序（跳过隐藏目录和 node_modules） */
export async function collectProjectTextFiles(folderPath: string): Promise<string[]> {
  const textFiles: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过隐藏目录和 node_modules
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (/\.(md|txt)$/i.test(entry.name)) {
        textFiles.push(fullPath);
      }
    }
  }
  await walk(folderPath);
  textFiles.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return textFiles;
}

/** 读取并以分隔线合并项目文本；无文件时返回 null */
export async function mergeProjectText(folderPath: string): Promise<string | null> {
  const textFiles = await collectProjectTextFiles(folderPath);
  if (textFiles.length === 0) return null;

  const contents: string[] = [];
  for (const filePath of textFiles) {
    const text = await readFile(filePath, 'utf-8');
    contents.push(text);
  }

  return contents.join('\n\n---\n\n');
}

export async function exportProjectToWord(
  folderPath: string,
  options: WordExportOptions = {}
): Promise<string | null> {
  const merged = await mergeProjectText(folderPath);
  if (merged === null) return null;

  const title = options.title || path.basename(folderPath);
  return exportToWord(merged, { ...options, title });
}
