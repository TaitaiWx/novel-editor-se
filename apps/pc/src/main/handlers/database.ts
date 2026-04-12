/**
 * Database IPC Handlers
 *
 * Handles: SQLite CRUD, settings, AI cache, data import/export
 */
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  initDatabase,
  isDatabaseReady,
  closeDatabase,
  novelOps,
  characterOps,
  outlineOps,
  outlineVersionOps,
  storyIdeaOps,
  worldSettingOps,
  statsOps,
  settingsOps,
  aiCacheOps,
  exportAllData,
  importData,
  type ExportData,
  type OutlineScope,
} from '@novel-editor/store';
import { getNativeBinding } from '../native-binding';

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
type StoryIdeaCardSource = 'manual' | 'ai';
type StoryIdeaCardStatus =
  | 'draft'
  | 'exploring'
  | 'shortlisted'
  | 'promoted_to_board'
  | 'promoted_to_outline'
  | 'archived';
type StoryIdeaOutputType = 'logline' | 'scene_hook' | 'outline_direction';

type KnowledgeTextExportOptions = {
  includeCharacters?: boolean;
  includeLore?: boolean;
  includeMaterials?: boolean;
};

type AssistantScopedMaterialExport = {
  title?: string;
  summary?: string;
  kind?: string;
  relatedChapter?: string;
};

type CharacterAttributesPayload = {
  aliases?: string[];
};

function parseCharacterAliases(attributesRaw?: string): string[] {
  if (!attributesRaw) return [];
  try {
    const parsed = JSON.parse(attributesRaw) as CharacterAttributesPayload;
    if (!Array.isArray(parsed.aliases)) return [];
    return parsed.aliases
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function formatKnowledgeExportMarkdown(payload: {
  projectName: string;
  folderPath: string;
  characters: Array<{
    name: string;
    role: string;
    description: string;
    attributes?: string;
  }>;
  loreEntries: Array<{
    category: string;
    title: string;
    content: string;
    tags: string;
  }>;
  materials: Array<{
    scopeKind: 'project' | 'volume' | 'chapter';
    scopePath: string;
    title: string;
    summary: string;
    kind: string;
    relatedChapter: string;
  }>;
  options: Required<KnowledgeTextExportOptions>;
}): string {
  const lines: string[] = [];
  lines.push(`# ${payload.projectName} - 创作资料导出`);
  lines.push('');
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`项目目录：${payload.folderPath}`);
  lines.push('');
  const selectedSections: string[] = [];
  if (payload.options.includeCharacters) selectedSections.push('角色卡');
  if (payload.options.includeLore) selectedSections.push('设定资料');
  if (payload.options.includeMaterials) selectedSections.push('资料卡');
  lines.push(`导出范围：${selectedSections.join(' / ')}`);
  lines.push('');

  if (payload.options.includeCharacters) {
    lines.push('## 角色卡');
    lines.push('');

    if (payload.characters.length === 0) {
      lines.push('（暂无角色）');
    } else {
      payload.characters.forEach((character, index) => {
        const aliases = parseCharacterAliases(character.attributes);
        lines.push(`### ${index + 1}. ${character.name || '未命名角色'}`);
        lines.push(`- 定位：${character.role || '未填写'}`);
        lines.push(`- 描述：${character.description || '未填写'}`);
        lines.push(`- 别名：${aliases.length > 0 ? aliases.join('、') : '无'}`);
        lines.push('');
      });
    }
  }

  if (payload.options.includeLore) {
    lines.push('## 设定资料');
    lines.push('');

    if (payload.loreEntries.length === 0) {
      lines.push('（暂无设定）');
    } else {
      payload.loreEntries.forEach((entry, index) => {
        const parsedTags = (() => {
          try {
            const tags = JSON.parse(entry.tags || '[]') as unknown;
            if (!Array.isArray(tags)) return [];
            return tags
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean);
          } catch {
            return [];
          }
        })();

        lines.push(`### ${index + 1}. ${entry.title || '未命名设定'}`);
        lines.push(`- 分类：${entry.category || 'world'}`);
        lines.push(`- 标签：${parsedTags.length > 0 ? parsedTags.join('、') : '无'}`);
        lines.push(`- 内容：${entry.content || '未填写'}`);
        lines.push('');
      });
    }
  }

  if (payload.options.includeMaterials) {
    lines.push('## 资料卡');
    lines.push('');

    if (payload.materials.length === 0) {
      lines.push('（暂无资料）');
    } else {
      payload.materials.forEach((item, index) => {
        const scopeText =
          item.scopeKind === 'chapter' ? '章节' : item.scopeKind === 'volume' ? '卷' : '项目';
        lines.push(`### ${index + 1}. ${item.title || '未命名资料'}`);
        lines.push(`- 类型：${item.kind || 'reference'}`);
        lines.push(`- 作用域：${scopeText}`);
        lines.push(`- 来源路径：${item.scopePath || '未知'}`);
        lines.push(`- 关联章节：${item.relatedChapter || '未填写'}`);
        lines.push(`- 内容：${item.summary || '未填写'}`);
        lines.push('');
      });
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

function normalizeKnowledgeExportOptions(
  options?: KnowledgeTextExportOptions
): Required<KnowledgeTextExportOptions> {
  const normalized = {
    includeCharacters: options?.includeCharacters !== false,
    includeLore: options?.includeLore !== false,
    includeMaterials: options?.includeMaterials !== false,
  };

  if (!normalized.includeCharacters && !normalized.includeLore && !normalized.includeMaterials) {
    throw new Error('请至少选择一种导出内容（角色/设定/资料）');
  }

  return normalized;
}

function normalizeWorkspacePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').toLowerCase();
}

function isPathInWorkspace(pathValue: string, folderPath: string): boolean {
  const normalizedFolder = normalizeWorkspacePath(folderPath).replace(/\/+$/, '');
  const normalizedPath = normalizeWorkspacePath(pathValue);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function collectScopedMaterialsByFolder(folderPath: string) {
  const MATERIAL_ARTIFACT_PREFIX = 'novel-editor:assistant-artifact:materials:';
  const allSettings = settingsOps.getAll() as Array<{ key: string; value: string }>;
  const materials: Array<{
    scopeKind: 'project' | 'volume' | 'chapter';
    scopePath: string;
    title: string;
    summary: string;
    kind: string;
    relatedChapter: string;
  }> = [];

  for (const row of allSettings) {
    if (!row?.key?.startsWith(MATERIAL_ARTIFACT_PREFIX)) continue;
    const rest = row.key.slice(MATERIAL_ARTIFACT_PREFIX.length);
    const firstColonIndex = rest.indexOf(':');
    if (firstColonIndex <= 0) continue;
    const scopeKind = rest.slice(0, firstColonIndex) as 'project' | 'volume' | 'chapter';
    if (scopeKind !== 'project' && scopeKind !== 'volume' && scopeKind !== 'chapter') continue;
    const scopePath = rest.slice(firstColonIndex + 1);
    if (!scopePath || !isPathInWorkspace(scopePath, folderPath)) continue;

    let parsed: AssistantScopedMaterialExport[] = [];
    try {
      const candidate = JSON.parse(row.value) as unknown;
      parsed = Array.isArray(candidate) ? (candidate as AssistantScopedMaterialExport[]) : [];
    } catch {
      parsed = [];
    }

    parsed.forEach((item) => {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      if (!title) return;
      materials.push({
        scopeKind,
        scopePath,
        title,
        summary: typeof item?.summary === 'string' ? item.summary.trim() : '',
        kind: typeof item?.kind === 'string' ? item.kind.trim() || 'reference' : 'reference',
        relatedChapter: typeof item?.relatedChapter === 'string' ? item.relatedChapter.trim() : '',
      });
    });
  }

  return materials;
}

function normalizeOutlineScope(folderPath: string, scope?: OutlineScopeInput): OutlineScope {
  if (scope?.kind === 'chapter' && scope.path) {
    return { kind: 'chapter', path: scope.path };
  }
  if (scope?.kind === 'volume' && scope.path) {
    return { kind: 'volume', path: scope.path };
  }
  return { kind: 'project', path: folderPath };
}

export function registerDatabaseHandlers(): void {
  // ─── Init / Close ──────────────────────────────────────────────────────────

  ipcMain.handle('db-init', (_event, dbDir: string) => {
    initDatabase(dbDir, 'novel-editor.db', getNativeBinding());
    return { success: true };
  });

  ipcMain.handle('db-init-default', () => {
    const defaultDbDir = path.join(app.getPath('userData'), '.novel-editor');
    initDatabase(defaultDbDir, 'novel-editor.db', getNativeBinding());
    return { success: true, dbDir: defaultDbDir };
  });

  ipcMain.handle('db-close', () => {
    closeDatabase();
    return { success: true };
  });

  // ─── Novel CRUD ────────────────────────────────────────────────────────────

  ipcMain.handle(
    'db-novel-create',
    (_event, name: string, folderPath: string, description?: string) =>
      novelOps.create(name, folderPath, description)
  );
  ipcMain.handle('db-novel-list', () => novelOps.getAll());
  ipcMain.handle('db-novel-get', (_event, id: number) => novelOps.getById(id));
  ipcMain.handle('db-novel-get-by-folder', (_event, folderPath: string) =>
    novelOps.getByFolder(folderPath)
  );
  ipcMain.handle(
    'db-novel-update',
    (_event, id: number, fields: { name?: string; description?: string }) =>
      novelOps.update(id, fields)
  );
  ipcMain.handle('db-novel-delete', (_event, id: number) => novelOps.delete(id));

  // ─── Character CRUD ────────────────────────────────────────────────────────

  ipcMain.handle(
    'db-character-create',
    (
      _event,
      novelId: number,
      name: string,
      role?: string,
      description?: string,
      attributes?: string
    ) => characterOps.create(novelId, name, role, description, attributes)
  );
  ipcMain.handle('db-character-list', (_event, novelId: number) =>
    characterOps.getByNovel(novelId)
  );
  ipcMain.handle(
    'db-character-update',
    (
      _event,
      id: number,
      fields: { name?: string; role?: string; description?: string; attributes?: string }
    ) => characterOps.update(id, fields)
  );
  ipcMain.handle('db-character-reorder', (_event, ids: number[]) => characterOps.reorder(ids));
  ipcMain.handle('db-character-delete', (_event, id: number) => characterOps.delete(id));
  ipcMain.handle('db-character-clear-by-novel', (_event, novelId: number) =>
    characterOps.clearByNovel(novelId)
  );

  // ─── Outline CRUD ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'db-outline-list-by-folder',
    (_event, folderPath: string, scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) return [];
      return outlineOps.getByScope(novel.id, normalizeOutlineScope(folderPath, scope));
    }
  );

  ipcMain.handle(
    'db-outline-replace-by-folder',
    (_event, folderPath: string, entries: OutlineTreeInput[], scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法写入大纲');
      }
      return outlineOps.replaceTree(novel.id, entries, normalizeOutlineScope(folderPath, scope));
    }
  );

  ipcMain.handle(
    'db-outline-clear-by-folder',
    (_event, folderPath: string, scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) return { changes: 0 };
      return outlineOps.clearByScope(novel.id, normalizeOutlineScope(folderPath, scope));
    }
  );

  ipcMain.handle('db-outline-reorder-by-folder', (_event, folderPath: string, ids: number[]) => {
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel) {
      throw new Error('项目不存在，无法排序大纲');
    }
    outlineOps.reorder(ids);
    return { changes: ids.length };
  });

  ipcMain.handle(
    'db-outline-version-list-by-folder',
    (_event, folderPath: string, scope?: OutlineScopeInput) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) return [];
      return outlineVersionOps.listByScope(novel.id, normalizeOutlineScope(folderPath, scope));
    }
  );

  ipcMain.handle(
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

  ipcMain.handle(
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
        version.scope_path !== normalizedScope.path
      ) {
        throw new Error('大纲版本不存在或不属于当前项目');
      }
      return outlineOps.replaceTree(novel.id, version.tree, normalizedScope);
    }
  );

  ipcMain.handle(
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

  ipcMain.handle('db-outline-version-delete', (_event, versionId: number) => {
    return outlineVersionOps.delete(versionId);
  });

  // ─── Story Idea / 三签创作法 ───────────────────────────────────────────

  ipcMain.handle('db-story-idea-card-list-by-folder', (_event, folderPath: string) => {
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel) return [];
    return storyIdeaOps.listCardsByNovel(novel.id);
  });

  ipcMain.handle(
    'db-story-idea-card-create-by-folder',
    (
      _event,
      folderPath: string,
      payload: {
        title: string;
        premise?: string;
        tagsJson?: string;
        source?: StoryIdeaCardSource;
        status?: StoryIdeaCardStatus;
        themeSeed?: string;
        conflictSeed?: string;
        twistSeed?: string;
        protagonistWish?: string;
        coreObstacle?: string;
        ironyOrGap?: string;
        escalationPath?: string;
        payoffHint?: string;
        selectedLogline?: string;
        selectedDirection?: string;
        note?: string;
      }
    ) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法创建三签创意卡');
      }
      return storyIdeaOps.createCard(novel.id, payload);
    }
  );

  ipcMain.handle(
    'db-story-idea-card-update',
    (
      _event,
      cardId: number,
      fields: {
        title?: string;
        premise?: string;
        tags_json?: string;
        source?: StoryIdeaCardSource;
        status?: StoryIdeaCardStatus;
        theme_seed?: string;
        conflict_seed?: string;
        twist_seed?: string;
        protagonist_wish?: string;
        core_obstacle?: string;
        irony_or_gap?: string;
        escalation_path?: string;
        payoff_hint?: string;
        selected_logline?: string;
        selected_direction?: string;
        note?: string;
      }
    ) => storyIdeaOps.updateCard(cardId, fields)
  );

  ipcMain.handle('db-story-idea-card-delete', (_event, cardId: number) => {
    return storyIdeaOps.deleteCard(cardId);
  });

  ipcMain.handle('db-story-idea-output-list', (_event, cardId: number) => {
    return storyIdeaOps.listOutputsByCard(cardId);
  });

  ipcMain.handle(
    'db-story-idea-output-replace-by-folder',
    (
      _event,
      folderPath: string,
      cardId: number,
      type: StoryIdeaOutputType,
      outputs: Array<{ content: string; metaJson?: string; isSelected?: boolean }>
    ) => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法保存三签候选');
      }
      return storyIdeaOps.replaceOutputs(novel.id, cardId, type, outputs);
    }
  );

  ipcMain.handle(
    'db-story-idea-output-update',
    (
      _event,
      outputId: number,
      fields: { content?: string; meta_json?: string; sort_order?: number; is_selected?: number }
    ) => storyIdeaOps.updateOutput(outputId, fields)
  );

  ipcMain.handle('db-story-idea-output-select', (_event, outputId: number) => {
    return storyIdeaOps.selectOutput(outputId);
  });

  ipcMain.handle('db-story-idea-output-delete', (_event, outputId: number) => {
    return storyIdeaOps.deleteOutput(outputId);
  });

  // ─── World Settings CRUD ──────────────────────────────────────────────────

  ipcMain.handle('db-world-setting-list-by-folder', (_event, folderPath: string) => {
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel) return [];
    return worldSettingOps.getByNovel(novel.id);
  });

  ipcMain.handle(
    'db-world-setting-create-by-folder',
    (_event, folderPath: string, category: string, title: string, content = '', tags = '[]') => {
      const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
      if (!novel) {
        throw new Error('项目不存在，无法创建设定条目');
      }
      return worldSettingOps.create(novel.id, category, title, content, tags);
    }
  );

  ipcMain.handle(
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

  ipcMain.handle(
    'db-world-setting-update',
    (
      _event,
      id: number,
      fields: { category?: string; title?: string; content?: string; tags?: string }
    ) => worldSettingOps.update(id, fields)
  );

  ipcMain.handle('db-world-setting-delete', (_event, id: number) => worldSettingOps.delete(id));
  ipcMain.handle('db-world-setting-clear-by-folder', (_event, folderPath: string) => {
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel) return { changes: 0 };
    return worldSettingOps.clearByNovel(novel.id);
  });

  // ─── Writing Stats ────────────────────────────────────────────────────────

  ipcMain.handle(
    'db-stats-record',
    (_event, novelId: number, date: string, wordCount: number, durationSeconds: number) =>
      statsOps.record(novelId, date, wordCount, durationSeconds)
  );
  ipcMain.handle('db-stats-range', (_event, novelId: number, startDate: string, endDate: string) =>
    statsOps.getByNovelAndRange(novelId, startDate, endDate)
  );
  ipcMain.handle('db-stats-today', (_event, novelId: number) => statsOps.getToday(novelId));

  // ─── Settings ─────────────────────────────────────────────────────────────

  ipcMain.handle('db-settings-get', (_event, key: string) => {
    if (!isDatabaseReady()) return undefined;
    return settingsOps.get(key);
  });
  ipcMain.handle('db-settings-set', (_event, key: string, value: string) => {
    settingsOps.set(key, value);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('settings-updated', key);
      }
    }
  });
  ipcMain.handle('db-settings-delete-prefixes', (_event, prefixes: string[]) => {
    const normalized = prefixes.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    );
    const removed = settingsOps.deleteByPrefixes(normalized);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        normalized.forEach((prefix) => win.webContents.send('settings-updated', prefix));
      }
    }
    return { removed };
  });
  ipcMain.handle('db-settings-all', () => settingsOps.getAll());

  // ─── AI Cache ─────────────────────────────────────────────────────────────

  ipcMain.handle('ai-cache-get', (_event, cacheKey: string, type: string) =>
    aiCacheOps.get(cacheKey, type)
  );
  ipcMain.handle('ai-cache-set', (_event, cacheKey: string, type: string, value: string) =>
    aiCacheOps.set(cacheKey, type, value)
  );
  ipcMain.handle('ai-cache-delete', (_event, cacheKey: string, type: string) =>
    aiCacheOps.delete(cacheKey, type)
  );
  ipcMain.handle('ai-cache-get-by-type', (_event, type: string) => aiCacheOps.getByType(type));
  ipcMain.handle('ai-cache-clear-by-type', (_event, type: string) => aiCacheOps.clearByType(type));
  ipcMain.handle('ai-cache-cleanup', (_event, maxAgeDays: number) =>
    aiCacheOps.cleanup(maxAgeDays)
  );
  ipcMain.handle('ai-cache-touch-keys', (_event, keys: Array<{ cacheKey: string; type: string }>) =>
    aiCacheOps.touchKeys(keys)
  );

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
