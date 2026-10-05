import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeLineDiff } from '@novel-editor/basic-algorithm';
import type {
  PersistedOutlineScopeKind,
  PersistedOutlineVersionRow,
} from '@/render/types/electron-api';
import type { OutlineEntry } from '../types';
import type { useDialog } from '../../Dialog';
import type { useOutlineEntries } from '../useOutlineEntries';
import {
  buildCompareLabel,
  parseVersionTree,
  serializeCurrentEntries,
  serializeVersionTree,
} from './helpers';

type OutlineEntriesApi = ReturnType<typeof useOutlineEntries>;

export interface OutlineVersionPreviewData {
  baseLabel: string;
  targetLabel: string;
  baseText: string;
  targetText: string;
  adds: number;
  dels: number;
  targetVersion: PersistedOutlineVersionRow;
  identical: boolean;
}

/**
 * 大纲版本中心逻辑：保存 / 应用 / 编辑 / 删除版本，A/B 对比选择与差异预览数据。
 */
export function useOutlineVersionCenter({
  dialog,
  versions,
  persistedEntries,
  scopeKind,
  saveOutlineVersion,
  applyOutlineVersion,
  updateOutlineVersion,
  deleteOutlineVersion,
}: {
  dialog: ReturnType<typeof useDialog>;
  versions: PersistedOutlineVersionRow[];
  persistedEntries: OutlineEntry[];
  scopeKind: PersistedOutlineScopeKind;
  saveOutlineVersion: OutlineEntriesApi['saveOutlineVersion'];
  applyOutlineVersion: OutlineEntriesApi['applyOutlineVersion'];
  updateOutlineVersion: OutlineEntriesApi['updateOutlineVersion'];
  deleteOutlineVersion: OutlineEntriesApi['deleteOutlineVersion'];
}) {
  const [compareBaseVersionId, setCompareBaseVersionId] = useState<number | null>(null);
  const [compareTargetVersionId, setCompareTargetVersionId] = useState<number | null>(null);
  const [highlightedStoryIdeaVersionId, setHighlightedStoryIdeaVersionId] = useState<number | null>(
    null
  );

  const handleSaveVersion = useCallback(async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultName = `手工保存 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const name = await dialog.prompt('保存为大纲版本', '请输入版本名称', defaultName);
    if (!name?.trim()) return;
    const note = await dialog.prompt('版本备注', '可选：记录这次保存的原因或阶段', '');
    await saveOutlineVersion({
      name: name.trim(),
      note: note?.trim() || '',
      source: 'manual',
    });
  }, [dialog, saveOutlineVersion]);

  const handleApplyVersion = useCallback(
    async (versionId: number, name: string) => {
      const confirmed = await dialog.confirm('应用大纲版本', `确定将「${name}」应用为当前大纲吗？`);
      if (!confirmed) return;
      await applyOutlineVersion(versionId);
      const appliedVersion = versions.find((version) => version.id === versionId) || null;
      setHighlightedStoryIdeaVersionId(appliedVersion?.story_idea_card_id ? versionId : null);
    },
    [applyOutlineVersion, dialog, versions]
  );

  const handleEditVersion = useCallback(
    async (versionId: number, currentName: string, currentNote: string) => {
      const nextName = await dialog.prompt('重命名大纲版本', '请输入版本名称', currentName);
      if (nextName === null) return;

      const trimmedName = nextName.trim();
      if (!trimmedName) return;

      const nextNote = await dialog.prompt(
        '编辑版本备注',
        '可选：记录这个版本的上下文',
        currentNote
      );
      if (nextNote === null) return;

      await updateOutlineVersion(versionId, {
        name: trimmedName,
        note: nextNote.trim(),
      });
    },
    [dialog, updateOutlineVersion]
  );

  const handleDeleteVersion = useCallback(
    async (versionId: number, name: string) => {
      const confirmed = await dialog.confirm(
        '删除大纲版本',
        `确定删除「${name}」吗？此操作不可撤销。`
      );
      if (!confirmed) return;
      await deleteOutlineVersion(versionId);
    },
    [deleteOutlineVersion, dialog]
  );

  const handleSetCompareBase = useCallback((versionId: number | null) => {
    setCompareBaseVersionId((current) => (current === versionId ? null : versionId));
  }, []);

  const handleSetCompareTarget = useCallback((versionId: number) => {
    setCompareTargetVersionId((current) => (current === versionId ? null : versionId));
  }, []);

  const compareBaseVersion = useMemo(
    () => versions.find((version) => version.id === compareBaseVersionId) || null,
    [compareBaseVersionId, versions]
  );

  const compareTargetVersion = useMemo(
    () => versions.find((version) => version.id === compareTargetVersionId) || null,
    [compareTargetVersionId, versions]
  );

  const previewData = useMemo((): OutlineVersionPreviewData | null => {
    if (!compareTargetVersion) return null;
    const baseText = compareBaseVersion
      ? serializeVersionTree(parseVersionTree(compareBaseVersion)).join('\n')
      : serializeCurrentEntries(persistedEntries);
    const targetText = serializeVersionTree(parseVersionTree(compareTargetVersion)).join('\n');
    const diffLines = computeLineDiff(baseText.split('\n'), targetText.split('\n'));
    let adds = 0;
    let dels = 0;
    diffLines.forEach((line) => {
      if (line.type === 'add') adds += 1;
      if (line.type === 'del') dels += 1;
    });
    return {
      baseLabel: buildCompareLabel(compareBaseVersion?.name || null, scopeKind),
      targetLabel: buildCompareLabel(compareTargetVersion.name, scopeKind),
      baseText,
      targetText,
      adds,
      dels,
      targetVersion: compareTargetVersion,
      identical: baseText === targetText,
    };
  }, [compareBaseVersion, compareTargetVersion, persistedEntries, scopeKind]);

  useEffect(() => {
    if (
      compareBaseVersionId !== null &&
      !versions.some((version) => version.id === compareBaseVersionId)
    ) {
      setCompareBaseVersionId(null);
    }
    if (
      compareTargetVersionId !== null &&
      !versions.some((version) => version.id === compareTargetVersionId)
    ) {
      setCompareTargetVersionId(null);
    }
  }, [compareBaseVersionId, compareTargetVersionId, versions]);

  return {
    compareBaseVersionId,
    compareTargetVersionId,
    highlightedStoryIdeaVersionId,
    handleSaveVersion,
    handleApplyVersion,
    handleEditVersion,
    handleDeleteVersion,
    handleSetCompareBase,
    handleSetCompareTarget,
    previewData,
  };
}
