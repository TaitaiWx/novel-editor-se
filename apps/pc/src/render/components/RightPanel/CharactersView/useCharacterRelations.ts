import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Character, CharacterRelation, RelationTone } from '../types';
import { RELATION_TONE_LABELS } from '../constants';
import { createRelationStorageKey } from '../utils';
import { useRelationNoteDrafts } from './useRelationNoteDrafts';
import { relationPairKey } from '@novel-editor/core/character-enrichment';

/**
 * 人物关系：加载/持久化关系列表，维护关系编辑表单状态。
 */
export function useCharacterRelations({
  folderPath,
  characters,
}: {
  folderPath: string | null;
  characters: Character[];
}) {
  const [relations, setRelations] = useState<CharacterRelation[]>([]);
  const [relationSourceId, setRelationSourceId] = useState<number | ''>('');
  const [relationTargetId, setRelationTargetId] = useState<number | ''>('');
  const [relationTone, setRelationTone] = useState<RelationTone>('ally');
  const [relationNote, setRelationNote] = useState('');
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null);

  const persistRelations = useCallback(
    async (nextRelations: CharacterRelation[]) => {
      const key = createRelationStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) throw new Error('无法保存关系，请先打开作品');
      await ipc.invoke('db-settings-set', key, JSON.stringify(nextRelations));
    },
    [folderPath]
  );

  const noteDrafts = useRelationNoteDrafts(
    folderPath,
    relations,
    persistRelations,
    setRelations,
    editingRelationId,
    characters
  );
  const links = useMemo(() => {
    const ids = new Set(characters.map((character) => character.id));
    return [...relations, ...Object.values(noteDrafts.additions)]
      .filter((relation) => ids.has(relation.sourceId) && ids.has(relation.targetId))
      .map((relation) =>
        noteDrafts.notes[relation.id]
          ? { ...relation, note: noteDrafts.notes[relation.id].value }
          : relation
      );
  }, [relations, characters, noteDrafts.notes, noteDrafts.additions]);

  useEffect(() => {
    // 切换项目时取消旧请求，避免较晚返回的旧项目关系覆盖新项目
    let cancelled = false;
    const loadRelations = async () => {
      const key = createRelationStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) {
        setRelations([]);
        return;
      }
      try {
        const raw = await ipc.invoke('db-settings-get', key);
        if (cancelled) return;
        setRelations(raw ? (JSON.parse(raw as string) as CharacterRelation[]) : []);
      } catch {
        if (cancelled) return;
        setRelations([]);
      }
    };
    loadRelations();
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const handleAddRelation = useCallback(async () => {
    if (relationSourceId === '' || relationTargetId === '' || relationSourceId === relationTargetId)
      return;
    if (
      links.some(
        (relation) =>
          relationPairKey(relation.sourceId, relation.targetId) ===
          relationPairKey(relationSourceId, relationTargetId)
      )
    )
      throw new Error('这两个人物已有关系，请点击图谱中的连线编辑。');
    const nextRelations = [
      ...relations,
      {
        id: `${Date.now()}`,
        sourceId: relationSourceId,
        targetId: relationTargetId,
        label: RELATION_TONE_LABELS[relationTone],
        tone: relationTone,
        note: relationNote.trim(),
      },
    ];
    await persistRelations(nextRelations);
    setRelations(nextRelations);
    setRelationNote('');
    setEditingRelationId(null);
  }, [
    relationSourceId,
    relationTargetId,
    relationTone,
    relationNote,
    relations,
    persistRelations,
    links,
  ]);

  const startEditRelation = useCallback((relation: CharacterRelation) => {
    setEditingRelationId(relation.id);
    setRelationSourceId(relation.sourceId);
    setRelationTargetId(relation.targetId);
    setRelationTone(relation.tone);
    setRelationNote(relation.note);
  }, []);

  const cancelEditRelation = useCallback(() => {
    setEditingRelationId(null);
    setRelationSourceId('');
    setRelationTargetId('');
    setRelationNote('');
    setRelationTone('ally');
  }, []);

  const handleUpdateRelation = useCallback(async () => {
    if (!editingRelationId) return;
    if (relationSourceId === '' || relationTargetId === '' || relationSourceId === relationTargetId)
      return;
    if (
      links.some(
        (relation) =>
          relation.id !== editingRelationId &&
          relationPairKey(relation.sourceId, relation.targetId) ===
            relationPairKey(relationSourceId, relationTargetId)
      )
    )
      throw new Error('这两个人物已有另一条关系，请选择其他人物。');
    const draft = noteDrafts.additions[editingRelationId];
    const nextRelations = [...relations, ...(draft ? [draft] : [])].map((item) =>
      item.id === editingRelationId
        ? {
            ...item,
            sourceId: relationSourceId,
            targetId: relationTargetId,
            tone: relationTone,
            label: RELATION_TONE_LABELS[relationTone],
            note: relationNote.trim(),
          }
        : item
    );
    await persistRelations(nextRelations);
    setRelations(nextRelations);
    noteDrafts.clear([editingRelationId]);
    setEditingRelationId(null);
  }, [
    editingRelationId,
    relationSourceId,
    relationTargetId,
    relationTone,
    relationNote,
    relations,
    persistRelations,
    noteDrafts,
    links,
  ]);

  const handleDeleteRelation = useCallback(
    async (relationId: string) => {
      if (noteDrafts.additions[relationId]) {
        noteDrafts.clear([relationId]);
        return;
      }
      const nextRelations = relations.filter((item) => item.id !== relationId);
      await persistRelations(nextRelations);
      setRelations(nextRelations);
      noteDrafts.clear([relationId]);
    },
    [relations, persistRelations, noteDrafts]
  );

  return {
    noteDrafts,
    relationBaseline: editingRelationId
      ? (noteDrafts.notes[editingRelationId]?.baseline ??
        relations.find((relation) => relation.id === editingRelationId)?.note ??
        '')
      : '',
    relations,
    setRelations,
    persistRelations,
    links,
    relationSourceId,
    setRelationSourceId,
    relationTargetId,
    setRelationTargetId,
    relationTone,
    setRelationTone,
    relationNote,
    setRelationNote,
    editingRelationId,
    handleAddRelation,
    startEditRelation,
    cancelEditRelation,
    handleUpdateRelation,
    handleDeleteRelation,
  };
}
