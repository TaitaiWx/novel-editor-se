import { useRef, useState } from 'react';
import {
  relationPairKey,
  type EnrichmentPerson,
  type EnrichmentValues,
} from '@novel-editor/core/character-enrichment';
import type { Character, CharacterRelation } from '../types';

type Notes = Record<string, { value: string; baseline: string }>;
type Drafts = { notes: Notes; additions: Record<string, CharacterRelation> };
const empty = (): Drafts => ({ notes: {}, additions: {} });
/** 关系说明和新连线共用社会关系草稿，作者确认后才保存。 */
export function useRelationNoteDrafts(
  scope: string | null,
  relations: CharacterRelation[],
  persist: (next: CharacterRelation[]) => Promise<void>,
  update: (next: CharacterRelation[]) => void,
  editingId: string | null,
  characters: Character[]
) {
  const [state, setState] = useState<Drafts & { scope: string | null }>({ scope, ...empty() });
  const drafts =
    state.scope === scope
      ? { notes: state.notes ?? {}, additions: state.additions ?? {} }
      : empty();
  const latest = useRef<Drafts>(drafts);
  latest.current = drafts;
  const setDrafts = (next: Drafts) => {
    latest.current = next;
    setState({ scope, ...next });
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const clear = (ids: string[]) => {
    const next = { notes: { ...latest.current.notes }, additions: { ...latest.current.additions } };
    ids.forEach((id) => {
      delete next.notes[id];
      delete next.additions[id];
    });
    setDrafts(next);
  };
  const fill = (values: EnrichmentValues, expected: EnrichmentPerson) => {
    const next = { notes: { ...latest.current.notes }, additions: { ...latest.current.additions } };
    let changed = false;
    for (const [id, value] of Object.entries(values.relationNotes ?? {})) {
      if (id === editingId) continue;
      const saved = relations.find((relation) => relation.id === id) ?? next.additions[id];
      const before = expected.relations?.find((relation) => relation.id === id);
      if (!saved || !before) continue;
      const current = next.notes[id]?.value ?? saved.note;
      if (current !== (before.note ?? '') || current === value) continue;
      next.notes[id] = { value, baseline: next.notes[id]?.baseline ?? saved.note };
      changed = true;
    }
    const ids = new Set(characters.map((character) => character.id));
    const pairs = new Set(
      [...relations, ...Object.values(next.additions)].map((edge) =>
        relationPairKey(edge.sourceId, edge.targetId)
      )
    );
    for (const relation of values.newRelations ?? []) {
      const pair = relationPairKey(relation.sourceId, relation.targetId);
      if (
        !ids.has(relation.sourceId) ||
        !ids.has(relation.targetId) ||
        relation.sourceId === relation.targetId ||
        pairs.has(pair)
      )
        continue;
      pairs.add(pair);
      next.additions[relation.id] = relation;
      changed = true;
    }
    if (changed) {
      setDrafts(next);
      setError('');
    }
    return changed;
  };
  const save = async () => {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setError('');
    const snapshot = latest.current;
    try {
      const base = [...relations, ...Object.values(snapshot.additions)];
      const ids = new Set(characters.map((character) => character.id));
      const pairs = new Set(relations.map((edge) => relationPairKey(edge.sourceId, edge.targetId)));
      for (const relation of Object.values(snapshot.additions)) {
        const pair = relationPairKey(relation.sourceId, relation.targetId);
        if (!ids.has(relation.sourceId) || !ids.has(relation.targetId) || pairs.has(pair))
          throw new Error('人物或关系已发生变化，请重新查看关系草稿后保存。');
        pairs.add(pair);
      }
      for (const [id, draft] of Object.entries(snapshot.notes)) {
        if (base.find((relation) => relation.id === id)?.note !== draft.baseline)
          throw new Error('关系说明已发生变化，请重新查看后再保存。');
      }
      const next = base.map((relation) =>
        snapshot.notes[relation.id]
          ? { ...relation, note: snapshot.notes[relation.id].value }
          : relation
      );
      await persist(next);
      update(next);
      clear([...Object.keys(snapshot.notes), ...Object.keys(snapshot.additions)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关系保存失败，请重试');
    } finally {
      locked.current = false;
      setSaving(false);
    }
  };
  return {
    notes: drafts.notes,
    additions: drafts.additions,
    fill,
    save,
    clear,
    discard: () => {
      setDrafts(empty());
      setError('');
    },
    hasDraft: Object.keys(drafts.notes).length > 0 || Object.keys(drafts.additions).length > 0,
    saving,
    error,
  };
}
export type RelationNoteDrafts = ReturnType<typeof useRelationNoteDrafts>;
