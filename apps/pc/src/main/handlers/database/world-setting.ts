import { registerWorkspaceHandler } from '../../workspace-ipc';
import { novelOps, worldSettingOps } from '@novel-editor/store';

/** 设定资料 CRUD */
export function registerWorldSettingHandlers(): void {
  // ─── World Settings CRUD ──────────────────────────────────────────────────

  registerWorkspaceHandler('db-world-setting-list-by-folder', (_event, folderPath: string) => {
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel) return [];
    return worldSettingOps.getByNovel(novel.id);
  });

  registerWorkspaceHandler(
    'db-world-setting-create-by-folder',
    (
      _event,
      folderPath: string,
      category: string,
      title: string,
      content = '',
      tags = '[]',
      attributes = '{}'
    ) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法创建设定条目');
      }
      return worldSettingOps.create(
        novel.id,
        category,
        title,
        content,
        tags,
        typeof attributes === 'string' ? attributes : '{}'
      );
    }
  );

  registerWorkspaceHandler(
    'db-world-setting-bulk-create-by-folder',
    (
      _event,
      folderPath: string,
      entries: Array<{ category: string; title: string; content?: string; tags?: string }>
    ) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法导入设定条目');
      }
      return worldSettingOps.bulkCreate(novel.id, entries);
    }
  );

  registerWorkspaceHandler(
    'db-world-setting-update',
    (
      _event,
      id: number,
      fields: {
        category?: string;
        title?: string;
        content?: string;
        tags?: string;
        attributes?: string;
      }
    ) => worldSettingOps.update(id, fields)
  );

  registerWorkspaceHandler('db-world-setting-delete', (_event, id: number) =>
    worldSettingOps.delete(id)
  );
  registerWorkspaceHandler('db-world-setting-clear-by-folder', (_event, folderPath: string) => {
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel) return { changes: 0 };
    return worldSettingOps.clearByNovel(novel.id);
  });
}
