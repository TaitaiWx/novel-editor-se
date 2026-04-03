import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  OutlineVersionSource,
  PersistedOutlineNodeInput,
  PersistedOutlineScopeInput,
  PersistedOutlineRow,
  PersistedOutlineVersionRow,
} from '@/render/types/electron-api';
import type { OutlineEntry } from './types';
import {
  buildOutlineTreeFromAi,
  buildOutlineTreeFromContent,
  buildOutlineTreeFromImports,
  OUTLINE_AI_GRANULARITY_LABELS,
  OUTLINE_AI_STYLE_LABELS,
  type OutlineAiGenerationOptions,
} from './outline-import';
import { buildOutlineEntries, fnv1a32 } from './utils';
import { extractOutline } from '@novel-editor/basic-algorithm';
import { useDebounce } from './useDebounce';

interface SaveOutlineVersionInput {
  name: string;
  source: OutlineVersionSource;
  note?: string;
  entries?: PersistedOutlineNodeInput[];
  silentStatus?: boolean;
}

function buildPersistedTreeFromRows(rows: PersistedOutlineRow[]): PersistedOutlineNodeInput[] {
  if (rows.length === 0) return [];

  const childrenMap = new Map<number | null, PersistedOutlineRow[]>();
  rows.forEach((row) => {
    const key = row.parent_id ?? null;
    const bucket = childrenMap.get(key);
    if (bucket) bucket.push(row);
    else childrenMap.set(key, [row]);
  });

  for (const bucket of childrenMap.values()) {
    bucket.sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
  }

  const visit = (parentId: number | null): PersistedOutlineNodeInput[] => {
    const nodes = childrenMap.get(parentId) || [];
    return nodes.map((row, index) => ({
      title: row.title,
      content: row.content,
      anchorText: row.anchor_text,
      lineHint: row.line_hint,
      sortOrder: row.sort_order ?? index,
      children: visit(row.id),
    }));
  };

  return visit(null);
}

function buildOutlineVersionName(source: OutlineVersionSource): string {
  const labels: Record<OutlineVersionSource, string> = {
    import: '导入大纲',
    rebuild: '正文重建',
    ai: 'AI 生成',
    manual: '手工保存',
  };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${labels[source]} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function normalizeAnchorText(value: string): string {
  return value
    .replace(/^#+\s*/, '')
    .replace(/[：:]+$/, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function buildAnchorIndex(lines: string[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const norm = normalizeAnchorText(lines[i]);
    if (norm && !index.has(norm)) {
      index.set(norm, i + 1);
    }
  }
  return index;
}

function resolveAnchorLineIndexed(
  anchorIndex: Map<string, number>,
  lines: string[],
  title: string,
  anchorText: string,
  lineHint: number | null
): number | null {
  const candidates = [anchorText, title].map((item) => normalizeAnchorText(item)).filter(Boolean);
  if (candidates.length === 0) {
    return typeof lineHint === 'number' && lineHint > 0 ? lineHint : null;
  }

  // Fast path: exact match in index
  for (const candidate of candidates) {
    const exact = anchorIndex.get(candidate);
    if (exact !== undefined) return exact;
  }

  // Fallback: substring match near lineHint
  const isMatch = (rawLine: string) => {
    const normalizedLine = normalizeAnchorText(rawLine);
    return candidates.some(
      (candidate) => normalizedLine === candidate || normalizedLine.includes(candidate)
    );
  };

  if (typeof lineHint === 'number' && lineHint > 0 && lineHint <= lines.length) {
    const windowStart = Math.max(0, lineHint - 4);
    const windowEnd = Math.min(lines.length, lineHint + 3);
    for (let index = windowStart; index < windowEnd; index += 1) {
      if (isMatch(lines[index])) return index + 1;
    }
  }

  return typeof lineHint === 'number' && lineHint > 0 ? lineHint : null;
}

function summarizeContent(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length <= 180 ? compact : `${compact.slice(0, 180)}...`;
}

function buildEntriesFromRows(rows: PersistedOutlineRow[], content: string): OutlineEntry[] {
  if (rows.length === 0) return [];
  const lines = content.split(/\r?\n/);
  const anchorIndex = buildAnchorIndex(lines);

  const childrenMap = new Map<number | null, PersistedOutlineRow[]>();
  rows.forEach((row) => {
    const key = row.parent_id ?? null;
    const bucket = childrenMap.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      childrenMap.set(key, [row]);
    }
  });

  for (const bucket of childrenMap.values()) {
    bucket.sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
  }

  const flattened: OutlineEntry[] = [];
  let sequence = 1;

  const visit = (parentId: number | null, level: number) => {
    const nodes = childrenMap.get(parentId) || [];
    nodes.forEach((row) => {
      const summary = summarizeContent(row.content);
      const resolvedLine = resolveAnchorLineIndexed(
        anchorIndex,
        lines,
        row.title,
        row.anchor_text || row.title,
        row.line_hint
      );
      flattened.push({
        id: row.id,
        parentId: row.parent_id,
        cacheKey: fnv1a32(`${row.id}:${row.title}:${row.updated_at}`),
        line: sequence++,
        lineHint: resolvedLine,
        level,
        text: row.title,
        summary,
        autoGenerated: false,
        source: 'database',
        anchorText: row.anchor_text || row.title,
        originalText: row.title,
        needsAiTitle: false,
        wordCount: row.content.replace(/\s+/g, '').length,
      });
      visit(row.id, level + 1);
    });
  };

  visit(null, 1);
  return flattened;
}

async function writeOutlineTree(
  folderPath: string,
  entries: PersistedOutlineNodeInput[],
  scope?: PersistedOutlineScopeInput | null
) {
  return window.electron.ipcRenderer.invoke(
    'db-outline-replace-by-folder',
    folderPath,
    entries,
    scope ?? undefined
  );
}

export function useOutlineEntries(
  folderPath: string | null,
  content: string,
  dbReady: boolean,
  aiReady: boolean,
  scope?: PersistedOutlineScopeInput | null
) {
  // Debounce content changes for liveEntries (300ms) to avoid re-parsing on every keystroke
  const debouncedContent = useDebounce(content, 300);

  const liveEntries = useMemo(() => {
    const headings = extractOutline(debouncedContent, { enableHeuristic: false });
    return buildOutlineEntries(debouncedContent, headings).map((entry) => ({
      ...entry,
      source: 'document' as const,
    }));
  }, [debouncedContent]);

  const [persistedRows, setPersistedRows] = useState<PersistedOutlineRow[]>([]);
  const [versions, setVersions] = useState<PersistedOutlineVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const persistedEntries = useMemo(
    () => buildEntriesFromRows(persistedRows, debouncedContent),
    [debouncedContent, persistedRows]
  );

  const hasPersistedOutline = persistedEntries.length > 0;
  const persistedTree = useMemo(() => buildPersistedTreeFromRows(persistedRows), [persistedRows]);

  const loadPersisted = useCallback(async () => {
    if (!folderPath || !dbReady) {
      setPersistedRows([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await window.electron.ipcRenderer.invoke(
        'db-outline-list-by-folder',
        folderPath,
        scope ?? undefined
      );
      setPersistedRows(rows);
      setStatusMessage('');
    } catch (error) {
      setPersistedRows([]);
      setStatusMessage(error instanceof Error ? error.message : '加载大纲失败');
    } finally {
      setLoading(false);
    }
  }, [dbReady, folderPath, scope?.kind, scope?.path]);

  useEffect(() => {
    void loadPersisted();
  }, [loadPersisted]);

  const loadVersions = useCallback(async () => {
    if (!folderPath || !dbReady) {
      setVersions([]);
      return;
    }
    try {
      const rows = await window.electron.ipcRenderer.invoke(
        'db-outline-version-list-by-folder',
        folderPath,
        scope ?? undefined
      );
      setVersions(rows);
    } catch {
      setVersions([]);
    }
  }, [dbReady, folderPath, scope?.kind, scope?.path]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const saveOutlineVersion = useCallback(
    async ({ name, source, note = '', entries, silentStatus = false }: SaveOutlineVersionInput) => {
      if (!folderPath || !dbReady) {
        if (!silentStatus) setStatusMessage('项目数据库尚未就绪，无法保存大纲版本');
        return false;
      }

      const targetEntries = entries ?? persistedTree;
      if (targetEntries.length === 0) {
        if (!silentStatus) setStatusMessage('当前没有可保存的大纲结构');
        return false;
      }

      await window.electron.ipcRenderer.invoke(
        'db-outline-version-create-by-folder',
        folderPath,
        {
          name,
          source,
          note,
          entries: targetEntries,
        },
        scope ?? undefined
      );
      await loadVersions();
      if (!silentStatus) setStatusMessage(`已保存大纲版本：${name}`);
      return true;
    },
    [dbReady, folderPath, loadVersions, persistedTree, scope?.kind, scope?.path]
  );

  const importOutline = useCallback(async () => {
    if (!folderPath || !dbReady) {
      setStatusMessage('项目数据库尚未就绪，无法导入大纲');
      return;
    }

    setImporting(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('import-structured-file');
      if (!result || result.previews.length === 0) {
        setStatusMessage('未选择可导入的大纲文件');
        return;
      }

      const tree = await buildOutlineTreeFromImports(result.previews, aiReady);
      if (tree.length === 0) {
        setStatusMessage('没有解析出可导入的大纲结构');
        return;
      }

      await writeOutlineTree(folderPath, tree, scope);
      await loadPersisted();
      let versionSaved = false;
      try {
        versionSaved = await saveOutlineVersion({
          name: buildOutlineVersionName('import'),
          source: 'import',
          note: `导入 ${result.previews.length} 个文件`,
          entries: tree,
          silentStatus: true,
        });
      } catch {
        versionSaved = false;
      }
      const importedCount = tree.length;
      const suffix = result.errors.length > 0 ? `，${result.errors.length} 个文件失败` : '';
      setStatusMessage(
        `已导入 ${importedCount} 个顶层节点${suffix}${versionSaved ? '，并保存为大纲版本' : ''}`
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '导入大纲失败');
    } finally {
      setImporting(false);
    }
  }, [aiReady, dbReady, folderPath, loadPersisted, saveOutlineVersion, scope?.kind, scope?.path]);

  const rebuildFromContent = useCallback(async () => {
    if (!folderPath || !dbReady) {
      setStatusMessage('项目数据库尚未就绪，无法同步正文目录');
      return;
    }

    const tree = await buildOutlineTreeFromContent(content, aiReady);
    if (tree.length === 0) {
      setStatusMessage('当前正文没有可重建的大纲结构（AI 与本地解析均未命中）');
      return;
    }

    setImporting(true);
    try {
      await writeOutlineTree(folderPath, tree, scope);
      await loadPersisted();
      let versionSaved = false;
      try {
        versionSaved = await saveOutlineVersion({
          name: buildOutlineVersionName('rebuild'),
          source: 'rebuild',
          note: '从正文重建当前大纲',
          entries: tree,
          silentStatus: true,
        });
      } catch {
        versionSaved = false;
      }
      setStatusMessage(
        `已从正文重建 ${tree.length} 个目录节点${versionSaved ? '，并保存为大纲版本' : ''}`
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '重建目录失败');
    } finally {
      setImporting(false);
    }
  }, [
    aiReady,
    content,
    dbReady,
    folderPath,
    loadPersisted,
    saveOutlineVersion,
    scope?.kind,
    scope?.path,
  ]);

  const clearPersisted = useCallback(async () => {
    if (!folderPath || !dbReady) {
      setStatusMessage('项目数据库尚未就绪，无法清空大纲');
      return;
    }

    setImporting(true);
    try {
      await window.electron.ipcRenderer.invoke(
        'db-outline-clear-by-folder',
        folderPath,
        scope ?? undefined
      );
      setPersistedRows([]);
      setStatusMessage('已清空已入库大纲，目录将回退为正文实时解析');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '清空大纲失败');
    } finally {
      setImporting(false);
    }
  }, [dbReady, folderPath, scope?.kind, scope?.path]);

  const applyOutlineVersion = useCallback(
    async (versionId: number) => {
      if (!folderPath || !dbReady) {
        setStatusMessage('项目数据库尚未就绪，无法应用大纲版本');
        return;
      }
      setImporting(true);
      try {
        await window.electron.ipcRenderer.invoke(
          'db-outline-version-apply-by-folder',
          folderPath,
          versionId,
          scope ?? undefined
        );
        await loadPersisted();
        await loadVersions();
        setStatusMessage('已将所选版本应用为当前大纲');
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : '应用大纲版本失败');
      } finally {
        setImporting(false);
      }
    },
    [dbReady, folderPath, loadPersisted, loadVersions, scope?.kind, scope?.path]
  );

  const updateOutlineVersion = useCallback(
    async (versionId: number, fields: { name?: string; note?: string }) => {
      const trimmedFields = {
        name: typeof fields.name === 'string' ? fields.name.trim() : undefined,
        note: typeof fields.note === 'string' ? fields.note.trim() : undefined,
      };

      if (!trimmedFields.name && trimmedFields.note === undefined) {
        setStatusMessage('未检测到可更新的大纲版本信息');
        return false;
      }

      try {
        await window.electron.ipcRenderer.invoke('db-outline-version-update', versionId, {
          ...(trimmedFields.name ? { name: trimmedFields.name } : {}),
          ...(trimmedFields.note !== undefined ? { note: trimmedFields.note } : {}),
        });
        await loadVersions();
        setStatusMessage('已更新大纲版本信息');
        return true;
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : '更新大纲版本信息失败');
        return false;
      }
    },
    [loadVersions]
  );

  const deleteOutlineVersion = useCallback(
    async (versionId: number) => {
      setImporting(true);
      try {
        await window.electron.ipcRenderer.invoke('db-outline-version-delete', versionId);
        await loadVersions();
        setStatusMessage('已删除大纲版本');
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : '删除大纲版本失败');
      } finally {
        setImporting(false);
      }
    },
    [loadVersions]
  );

  const generateAiOutline = useCallback(
    async (options?: OutlineAiGenerationOptions) => {
      if (!folderPath || !dbReady) {
        setStatusMessage('项目数据库尚未就绪，无法生成 AI 大纲');
        return;
      }
      if (!aiReady) {
        setStatusMessage('请先配置并开启 AI，再使用 AI 生成大纲');
        return;
      }

      setImporting(true);
      try {
        const tree = await buildOutlineTreeFromAi(content, aiReady, options);
        if (tree.length === 0) {
          setStatusMessage('AI 未生成可用的大纲结构，请调整正文内容后重试');
          return;
        }

        await writeOutlineTree(folderPath, tree, scope);
        await loadPersisted();
        let versionSaved = false;
        const optionsSummary = options
          ? `${OUTLINE_AI_STYLE_LABELS[options.style]} / ${OUTLINE_AI_GRANULARITY_LABELS[options.granularity]} / ${options.maxDepth} 层`
          : '默认参数';
        try {
          versionSaved = await saveOutlineVersion({
            name: buildOutlineVersionName('ai'),
            source: 'ai',
            note: `基于当前正文由 AI 生成大纲（${optionsSummary}）`,
            entries: tree,
            silentStatus: true,
          });
        } catch {
          versionSaved = false;
        }
        setStatusMessage(
          `已通过 AI 生成 ${tree.length} 个大纲节点（${optionsSummary}）${versionSaved ? '，并保存为大纲版本' : ''}`
        );
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'AI 生成大纲失败');
      } finally {
        setImporting(false);
      }
    },
    [
      aiReady,
      content,
      dbReady,
      folderPath,
      loadPersisted,
      saveOutlineVersion,
      scope?.kind,
      scope?.path,
    ]
  );

  const reorderEntries = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!folderPath || !dbReady || !hasPersistedOutline) return;
      if (fromIndex === toIndex) return;

      // Only reorder top-level (parentId === null) entries for simplicity.
      // Build the ordered list of top-level IDs from persistedRows.
      const topLevelRows = persistedRows
        .filter((r) => r.parent_id === null)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

      if (fromIndex < 0 || fromIndex >= topLevelRows.length) return;
      if (toIndex < 0 || toIndex >= topLevelRows.length) return;

      const reordered = [...topLevelRows];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      const ids = reordered.map((r) => r.id);

      // Optimistic UI update
      const newRows = persistedRows.map((row) => {
        if (row.parent_id !== null) return row;
        const newOrder = ids.indexOf(row.id);
        return newOrder >= 0 ? { ...row, sort_order: newOrder } : row;
      });
      setPersistedRows(newRows);

      try {
        await window.electron.ipcRenderer.invoke('db-outline-reorder-by-folder', folderPath, ids);
      } catch {
        // Revert on failure
        await loadPersisted();
      }
    },
    [dbReady, folderPath, hasPersistedOutline, persistedRows, loadPersisted]
  );

  return {
    liveEntries,
    persistedEntries,
    versions,
    hasPersistedOutline,
    loading,
    importing,
    statusMessage,
    importOutline,
    rebuildFromContent,
    clearPersisted,
    saveOutlineVersion,
    applyOutlineVersion,
    updateOutlineVersion,
    deleteOutlineVersion,
    generateAiOutline,
    reorderEntries,
  };
}
