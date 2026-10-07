import { useStructureClassifier } from '@/render/utils/structureRules';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PersistedOutlineNodeInput,
  PersistedOutlineScopeInput,
  PersistedOutlineRow,
  PersistedOutlineVersionRow,
} from '@/render/types/electron-api';
import {
  buildOutlineTreeFromAi,
  buildOutlineTreeFromContent,
  buildOutlineTreeFromImports,
  OUTLINE_AI_GRANULARITY_LABELS,
  OUTLINE_AI_STYLE_LABELS,
  type OutlineAiGenerationOptions,
} from './outline-import';
import { buildOutlineEntries } from './utils';
import { extractOutline } from '@novel-editor/basic-algorithm';
import { useDebounce } from './useDebounce';
import {
  buildEntriesFromRows,
  buildOutlineVersionName,
  buildPersistedTreeFromRows,
  writeOutlineTree,
  type SaveOutlineVersionInput,
} from './outline-entries';

export function useOutlineEntries(
  folderPath: string | null,
  content: string,
  dbReady: boolean,
  aiReady: boolean,
  scope?: PersistedOutlineScopeInput | null
) {
  // 按 kind / path 归一化作用域：调用方每次渲染可能传入新对象，
  // 只有字段真正变化时才更新引用，避免重复触发大纲 / 版本加载
  const scopeKind = scope?.kind;
  const scopePath = scope?.path;
  const outlineScope = useMemo<PersistedOutlineScopeInput | null>(
    () =>
      scopeKind !== undefined && scopePath !== undefined
        ? { kind: scopeKind, path: scopePath }
        : null,
    [scopeKind, scopePath]
  );

  // Debounce content changes for liveEntries (300ms) to avoid re-parsing on every keystroke
  const debouncedContent = useDebounce(content, 300);
  const classify = useStructureClassifier();

  const liveEntries = useMemo(() => {
    // 章标题按项目的正文结构规则识别（设置 → 正文结构，例如 English「Chapter 1」）
    const headings = extractOutline(debouncedContent, { enableHeuristic: false, classify });
    return buildOutlineEntries(debouncedContent, headings).map((entry) => ({
      ...entry,
      source: 'document' as const,
    }));
  }, [debouncedContent, classify]);

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
        outlineScope ?? undefined
      );
      setPersistedRows(rows);
      setStatusMessage('');
    } catch (error) {
      setPersistedRows([]);
      setStatusMessage(error instanceof Error ? error.message : '加载大纲失败');
    } finally {
      setLoading(false);
    }
  }, [dbReady, folderPath, outlineScope]);

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
        outlineScope ?? undefined
      );
      setVersions(rows);
    } catch {
      setVersions([]);
    }
  }, [dbReady, folderPath, outlineScope]);

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
        outlineScope ?? undefined
      );
      await loadVersions();
      if (!silentStatus) setStatusMessage(`已保存大纲版本：${name}`);
      return true;
    },
    [dbReady, folderPath, loadVersions, persistedTree, outlineScope]
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

      await writeOutlineTree(folderPath, tree, outlineScope);
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
  }, [aiReady, dbReady, folderPath, loadPersisted, saveOutlineVersion, outlineScope]);

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
      await writeOutlineTree(folderPath, tree, outlineScope);
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
  }, [aiReady, content, dbReady, folderPath, loadPersisted, saveOutlineVersion, outlineScope]);

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
        outlineScope ?? undefined
      );
      setPersistedRows([]);
      setStatusMessage('已清空已入库大纲，目录将回退为正文实时解析');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '清空大纲失败');
    } finally {
      setImporting(false);
    }
  }, [dbReady, folderPath, outlineScope]);

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
          outlineScope ?? undefined
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
    [dbReady, folderPath, loadPersisted, loadVersions, outlineScope]
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

  /** 把一份生成好的大纲写入数据库并保存为版本（AI 单个生成 / 多方案采用共用） */
  const applyOutlineTree = useCallback(
    async (tree: PersistedOutlineNodeInput[], options?: OutlineAiGenerationOptions) => {
      if (!folderPath || !dbReady) return;
      setImporting(true);
      try {
        await writeOutlineTree(folderPath, tree, outlineScope);
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
        setStatusMessage(error instanceof Error ? error.message : '写入大纲失败');
      } finally {
        setImporting(false);
      }
    },
    [dbReady, folderPath, loadPersisted, outlineScope, saveOutlineVersion]
  );

  const ensureAiReady = useCallback((): boolean => {
    if (!folderPath || !dbReady) {
      setStatusMessage('项目数据库尚未就绪，无法生成 AI 大纲');
      return false;
    }
    if (!aiReady) {
      setStatusMessage('请先配置并开启 AI，再使用 AI 生成大纲');
      return false;
    }
    return true;
  }, [aiReady, dbReady, folderPath]);

  const generateAiOutline = useCallback(
    async (options?: OutlineAiGenerationOptions) => {
      if (!ensureAiReady()) return;
      setImporting(true);
      let tree: PersistedOutlineNodeInput[] = [];
      try {
        tree = await buildOutlineTreeFromAi(content, aiReady, options);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'AI 生成大纲失败');
        setImporting(false);
        return;
      }
      setImporting(false);
      if (tree.length === 0) {
        setStatusMessage('AI 未生成可用的大纲结构，请调整正文内容后重试');
        return;
      }
      await applyOutlineTree(tree, options);
    },
    [aiReady, applyOutlineTree, content, ensureAiReady]
  );

  /** 一次生成几种风格的大纲方案（并行），不写入数据库，由作者挑一个 applyOutlineTree */
  const generateAiOutlineVariants = useCallback(
    async (
      variants: OutlineAiGenerationOptions[]
    ): Promise<
      Array<{ options: OutlineAiGenerationOptions; tree: PersistedOutlineNodeInput[] }>
    > => {
      if (!ensureAiReady()) return [];
      setImporting(true);
      try {
        const trees = await Promise.all(
          variants.map((options) =>
            buildOutlineTreeFromAi(content, aiReady, options).catch(
              () => [] as PersistedOutlineNodeInput[]
            )
          )
        );
        const result = variants
          .map((options, index) => ({ options, tree: trees[index] }))
          .filter((item) => item.tree.length > 0);
        setStatusMessage(
          result.length > 0
            ? `AI 给出 ${result.length} 种章纲，选一个采用`
            : 'AI 未生成可用的大纲结构，请调整正文内容后重试'
        );
        return result;
      } finally {
        setImporting(false);
      }
    },
    [aiReady, content, ensureAiReady]
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
    generateAiOutlineVariants,
    applyOutlineTree,
    reorderEntries,
  };
}
