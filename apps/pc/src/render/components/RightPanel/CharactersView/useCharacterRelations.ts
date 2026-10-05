import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Character, CharacterRelation, RelationTone } from '../types';
import { RELATION_TONE_LABELS } from '../constants';
import { buildCharacterLinks, createRelationStorageKey } from '../utils';

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
  const [relationLabel, setRelationLabel] = useState('');
  const [relationTone, setRelationTone] = useState<RelationTone>('ally');
  const [relationNote, setRelationNote] = useState('');
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null);

  const links = useMemo(
    () =>
      relations.length > 0
        ? relations
        : buildCharacterLinks(characters).map((item, index) => ({
            id: `generated-${index}`,
            sourceId: item.sourceId,
            targetId: item.targetId,
            label: item.label,
            tone: 'other' as RelationTone,
            note: '',
          })),
    [relations, characters]
  );
  const persistRelations = useCallback(
    async (nextRelations: CharacterRelation[]) => {
      const key = createRelationStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) return;
      await ipc.invoke('db-settings-set', key, JSON.stringify(nextRelations));
    },
    [folderPath]
  );

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
    const nextRelations = [
      ...relations,
      {
        id: `${Date.now()}`,
        sourceId: relationSourceId,
        targetId: relationTargetId,
        label: relationLabel.trim() || RELATION_TONE_LABELS[relationTone],
        tone: relationTone,
        note: relationNote.trim(),
      },
    ];
    setRelations(nextRelations);
    setRelationLabel('');
    setRelationNote('');
    await persistRelations(nextRelations);
    setEditingRelationId(null);
  }, [
    relationSourceId,
    relationTargetId,
    relationLabel,
    relationTone,
    relationNote,
    relations,
    persistRelations,
  ]);

  const startEditRelation = useCallback((relation: CharacterRelation) => {
    setEditingRelationId(relation.id);
    setRelationSourceId(relation.sourceId);
    setRelationTargetId(relation.targetId);
    setRelationTone(relation.tone);
    setRelationLabel(relation.label);
    setRelationNote(relation.note);
  }, []);

  const handleUpdateRelation = useCallback(async () => {
    if (!editingRelationId) return;
    if (relationSourceId === '' || relationTargetId === '' || relationSourceId === relationTargetId)
      return;
    const nextRelations = relations.map((item) =>
      item.id === editingRelationId
        ? {
            ...item,
            sourceId: relationSourceId,
            targetId: relationTargetId,
            tone: relationTone,
            label: relationLabel.trim() || RELATION_TONE_LABELS[relationTone],
            note: relationNote.trim(),
          }
        : item
    );
    setRelations(nextRelations);
    await persistRelations(nextRelations);
    setEditingRelationId(null);
  }, [
    editingRelationId,
    relationSourceId,
    relationTargetId,
    relationTone,
    relationLabel,
    relationNote,
    relations,
    persistRelations,
  ]);

  const handleDeleteRelation = useCallback(
    async (relationId: string) => {
      const nextRelations = relations.filter((item) => item.id !== relationId);
      setRelations(nextRelations);
      await persistRelations(nextRelations);
    },
    [relations, persistRelations]
  );

  return {
    relations,
    setRelations,
    persistRelations,
    links,
    relationSourceId,
    setRelationSourceId,
    relationTargetId,
    setRelationTargetId,
    relationLabel,
    setRelationLabel,
    relationTone,
    setRelationTone,
    relationNote,
    setRelationNote,
    editingRelationId,
    handleAddRelation,
    startEditRelation,
    handleUpdateRelation,
    handleDeleteRelation,
  };
}
