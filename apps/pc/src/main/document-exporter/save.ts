/** 导出文件的保存对话框 + 写盘 */
import { dialog } from 'electron';
import { writeFile } from 'fs/promises';

export interface SaveDialogConfig {
  title: string;
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}

/** 弹出保存对话框并写入内容；用户取消时返回 null */
export async function saveBufferWithDialog(
  buffer: Buffer,
  config: SaveDialogConfig
): Promise<string | null> {
  const result = await dialog.showSaveDialog(config);
  if (result.canceled || !result.filePath) return null;

  await writeFile(result.filePath, buffer);
  return result.filePath;
}
