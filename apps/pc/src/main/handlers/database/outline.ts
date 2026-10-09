import { registerWorkspaceHandler } from '../../workspace-ipc';
import { novelOps, outlineOps, outlineVersionOps, type OutlineScope } from '@novel-editor/store';

type OutlineTreeInput = {
  title: string;
  content?: string;
  anchorText?: string;
  lineHint?: number | null;
  sortOrder?: number;
  children?: OutlineTreeInput[];
};

type OutlineVersionSource = 'import' | 'rebuild' | 'ai' | 'manual';
type OutlineScopeInput = {
  kind?: 'project' | 'volume' | 'chapter';
  path?: string | null;
};

function normalizeOutlineScope(folderPath: string, scope?: OutlineScopeInput): OutlineScope {
  if (scope?.kind === 'chapter' && scope.path) {
    return { kind: 'chapter', path: scope.path };
  }
  if (scope?.kind === 'volume' && scope.path) {
    return { kind: 'volume', path: scope.path };
  }
  return { kind: 'project', path: folderPath };
}

/** 大纲与大纲版本 */
export function registerOutlineHandlers(): void {
  // ─── Outline CRUD ─────────────────────────────────────────────────────────

  registerWorkspaceHandler(
    'db-outline-list-by-folder',
    (_event, folderPath: string, scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) return [];
      return outlineOps.getByScope(novel.id, normalizeOutlineScope(folderPath, scope));
    }
  );

  registerWorkspaceHandler(
    'db-outline-replace-by-folder',
    (_event, folderPath: string, entries: OutlineTreeInput[], scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法写入大纲');
      }
      return outlineOps.replaceTree(novel.id, entries, normalizeOutlineScope(folderPath, scope));
    }
  );

  registerWorkspaceHandler(
    'db-outline-clear-by-folder',
    (_event, folderPath: string, scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) return { changes: 0 };
      return outlineOps.clearByScope(novel.id, normalizeOutlineScope(folderPath, scope));
    }
  );

  registerWorkspaceHandler(
    'db-outline-reorder-by-folder',
    (_event, folderPath: string, ids: number[]) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法排序大纲');
      }
      outlineOps.reorder(ids);
      return { changes: ids.length };
    }
  );

  registerWorkspaceHandler(
    'db-outline-version-list-by-folder',
    (_event, folderPath: string, scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) return [];
      return outlineVersionOps.listByScope(novel.id, normalizeOutlineScope(folderPath, scope));
    }
  );

  registerWorkspaceHandler(
    'db-outline-version-create-by-folder',
    (
      _event,
      folderPath: string,
      payload: {
        name: string;
        source: OutlineVersionSource;
        note?: string;
        storyIdeaCardId?: number | null;
        storyIdeaSnapshotJson?: string;
        entries: OutlineTreeInput[];
      },
      scope?: OutlineScopeInput
    ) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法保存大纲版本');
      }
      return outlineVersionOps.create(
        novel.id,
        payload.name,
        payload.source,
        payload.note || '',
        payload.entries,
        {
          scope: normalizeOutlineScope(folderPath, scope),
          storyIdeaCardId: payload.storyIdeaCardId,
          storyIdeaSnapshotJson: payload.storyIdeaSnapshotJson,
        }
      );
    }
  );

  registerWorkspaceHandler(
    'db-outline-version-apply-by-folder',
    (_event, folderPath: string, versionId: number, scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法应用大纲版本');
      }
      const version = outlineVersionOps.getById(versionId);
      const normalizedScope = normalizeOutlineScope(folderPath, scope);
      if (
        !version ||
        version.novel_id !== novel.id ||
        version.scope_kind !== normalizedScope.kind ||
        // 旧数据的项目级版本 scope_path 为空串，列表查询会一并返回，这里也要允许应用
        (version.scope_path !== normalizedScope.path &&
          !(normalizedScope.kind === 'project' && version.scope_path === ''))
      ) {
        throw new Error('大纲版本不存在或不属于当前项目');
      }
      return outlineOps.replaceTree(novel.id, version.tree, normalizedScope);
    }
  );

  registerWorkspaceHandler(
    'db-outline-version-update',
    (
      _event,
      versionId: number,
      fields: {
        name?: string;
        note?: string;
      }
    ) => {
      return outlineVersionOps.update(versionId, fields);
    }
  );

  registerWorkspaceHandler('db-outline-version-delete', (_event, versionId: number) => {
    return outlineVersionOps.delete(versionId);
  });
}
