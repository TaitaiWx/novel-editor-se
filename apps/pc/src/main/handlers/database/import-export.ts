import { ipcMain, dialog } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import {
  novelOps,
  characterOps,
  worldSettingOps,
  exportAllData,
  importData,
  type ExportData,
} from '@novel-editor/store';
import {
  collectScopedMaterialsByFolder,
  formatKnowledgeExportMarkdown,
  normalizeKnowledgeExportOptions,
  type KnowledgeTextExportOptions,
} from './knowledge-export';

/** 数据导入导出与创作资料导出 */
export function registerImportExportHandlers(): void {
  // ─── Import / Export ──────────────────────────────────────────────────────

  ipcMain.handle('db-export', () => exportAllData());
  ipcMain.handle('db-import', (_event, data: ExportData) => {
    importData(data);
    return { success: true };
  });

  ipcMain.handle('db-export-to-file', async () => {
    const result = await dialog.showSaveDialog({
      title: '导出数据',
      defaultPath: `novel-editor-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const data = exportAllData();
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return result.filePath;
  });

  ipcMain.handle(
    'db-export-knowledge-text',
    async (_event, folderPath: string, options?: KnowledgeTextExportOptions) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number; name: string } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法导出角色卡、设定与资料');
      }
      const normalizedOptions = normalizeKnowledgeExportOptions(options);

      const result = await dialog.showSaveDialog({
        title: '导出角色卡、设定与资料',
        defaultPath: `${novel.name || 'novel'}-角色设定资料导出-${new Date().toISOString().slice(0, 10)}.md`,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
        ],
      });
      if (result.canceled || !result.filePath) return null;

      const characters = characterOps.getByNovel(novel.id) as Array<{
        name: string;
        role: string;
        description: string;
        attributes?: string;
      }>;
      const loreEntries = worldSettingOps.getByNovel(novel.id) as Array<{
        category: string;
        title: string;
        content: string;
        tags: string;
      }>;
      const materials = collectScopedMaterialsByFolder(folderPath);

      const markdown = formatKnowledgeExportMarkdown({
        projectName: novel.name,
        folderPath,
        characters,
        loreEntries,
        materials,
        options: normalizedOptions,
      });
      await writeFile(result.filePath, markdown, 'utf-8');
      return result.filePath;
    }
  );

  ipcMain.handle('db-import-from-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入数据',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const content = await readFile(result.filePaths[0], 'utf-8');
    const data = JSON.parse(content) as ExportData;
    importData(data);
    return { success: true, filePath: result.filePaths[0] };
  });
}
