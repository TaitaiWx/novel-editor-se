import { useRef, useState } from 'react';
import {
  CHARACTER_TRAIT_FIELD_KEYS,
  CHARACTER_CONTEXT_FIELD_KEYS,
  type CharacterDesign,
} from '@novel-editor/core/entity-media';
import type {
  EnrichmentPerson,
  EnrichmentValues,
  EnrichmentVoice,
  EnrichmentChapter,
} from '@novel-editor/core/character-enrichment';
import {
  DEVELOPMENT_KINDS,
  developmentEntries,
  type DevelopmentMap,
} from '@novel-editor/core/character-development';
import type { Character } from '../../types';
import { useUnsavedChangesGuard } from '@/render/hooks/useUnsavedChangesGuard';
import { enrichSavedEntry } from '../CharacterDevelopment/entryMetadata';

interface Draft {
  values: EnrichmentValues;
  expected: EnrichmentValues;
}
const empty = (): EnrichmentValues => ({ design: {}, voice: {}, development: {} });
const groups = ['design', 'voice', 'development'] as const;
export type ProfileDraftTab = 'design' | 'environment' | 'social' | 'power' | 'plot';
const hasValues = (values: EnrichmentValues) =>
  groups.some((group) => Object.keys(values[group]).length > 0);
/** 全部分页共用草稿，作者确认时才原子保存；切换分页保留内容。 */
export function useProfileDraft(
  character: Character | null,
  workPath: string | null,
  onBlocked?: () => void,
  chapters: EnrichmentChapter[] = []
) {
  const scope = JSON.stringify([workPath, character?.id]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftsRef = useRef(drafts);
  const updateDrafts = (update: (all: Record<string, Draft>) => Record<string, Draft>) => {
    draftsRef.current = update(draftsRef.current);
    setDrafts(draftsRef.current);
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const draft = drafts[scope];
  useUnsavedChangesGuard(saving || Object.keys(drafts).length > 0, onBlocked);
  const fill = (values: EnrichmentValues, expected: EnrichmentPerson) => {
    const draft = draftsRef.current[scope];
    const next: Draft = structuredClone(draft ?? { values: empty(), expected: empty() });
    let filled = false;
    for (const section of groups) {
      const current = { ...character?.[section], ...draft?.values[section] } as Record<
        string,
        string
      >;
      const before = (expected[section] ?? {}) as Record<string, string>;
      const baseline = (character?.[section] ?? {}) as Record<string, string>;
      for (const [key, value] of Object.entries(values[section])) {
        if ((current[key] ?? '') !== (before[key] ?? '') || value === (current[key] ?? ''))
          continue;
        filled = true;
        (next.values[section] as Record<string, string>)[key] = value;
        (next.expected[section] as Record<string, string>)[key] ??= baseline[key] ?? '';
      }
    }
    if (!filled) return false;
    updateDrafts((all) => ({ ...all, [scope]: next }));
    setError('');
    return true;
  };
  const editGroup = (
    section: (typeof groups)[number],
    values: Record<string, string>,
    expected: Record<string, string>
  ) => {
    updateDrafts((all) => {
      const current = all[scope];
      if (!current) return all;
      const next = structuredClone(current);
      for (const [key, value] of Object.entries(values)) {
        if (
          section === 'development' &&
          value === '' &&
          !developmentEntries(character?.development, character?.design).some(
            (entry) => entry.id === key
          )
        ) {
          delete next.values.development[key];
          delete next.expected.development[key];
          continue;
        }
        (next.values[section] as Record<string, string>)[key] = value;
        (next.expected[section] as Record<string, string>)[key] ??= expected[key] ?? '';
      }
      const result = { ...all };
      if (hasValues(next.values)) result[scope] = next;
      else delete result[scope];
      return result;
    });
  };
  const edit = (key: keyof CharacterDesign, value: string, expected: string) =>
    editGroup('design', { [key]: value }, { [key]: expected });
  const editVoice = (values: EnrichmentVoice) =>
    editGroup('voice', values, { ...character?.voice });
  const editDevelopment = (values: DevelopmentMap) =>
    editGroup('development', values, character?.development ?? {});
  const selectTab = (source: Draft, tab: string): Draft => {
    const selected: Draft = { values: empty(), expected: empty() };
    const entries = developmentEntries(
      { ...character?.development, ...source.values.development },
      character?.design
    );
    const previous = developmentEntries(character?.development, character?.design);
    for (const group of groups) {
      for (const [key, value] of Object.entries(source.values[group])) {
        let belongs = false;
        if (group === 'design')
          belongs = (
            tab === 'design'
              ? CHARACTER_TRAIT_FIELD_KEYS
              : tab === 'environment'
                ? CHARACTER_CONTEXT_FIELD_KEYS
                : []
          ).includes(key as keyof CharacterDesign);
        else if (group === 'voice') belongs = tab === 'design';
        else {
          const entry =
            entries.find((item) => item.id === key) ?? previous.find((item) => item.id === key);
          const section = DEVELOPMENT_KINDS.find((kind) => kind.id === entry?.kind)?.section;
          belongs = section === (tab === 'environment' ? 'identity' : tab);
        }
        if (!belongs) continue;
        (selected.values[group] as Record<string, string>)[key] = value;
        (selected.expected[group] as Record<string, string>)[key] =
          (source.expected[group] as Record<string, string>)[key] ?? '';
      }
    }
    return selected;
  };
  const clearSelected = (selected: Draft) =>
    updateDrafts((all) => {
      const current = all[scope];
      if (!current) return all;
      const next = structuredClone(current);
      for (const group of groups)
        for (const [key, value] of Object.entries(selected.values[group])) {
          // 保存期间其他分页仍可生成；只移除本次确认且没有再次变动的字段。
          if ((next.values[group] as Record<string, string>)[key] !== value) continue;
          delete (next.values[group] as Record<string, string>)[key];
          delete (next.expected[group] as Record<string, string>)[key];
        }
      const result = { ...all };
      if (hasValues(next.values)) result[scope] = next;
      else delete result[scope];
      return result;
    });
  const hasTabDraft = (tab: string) => !!draft && hasValues(selectTab(draft, tab).values);
  const discard = (tab: ProfileDraftTab) => {
    const current = draftsRef.current[scope];
    if (current) clearSelected(selectTab(current, tab));
    setError('');
  };
  const save = async (tab: ProfileDraftTab) => {
    const current = draftsRef.current[scope];
    if (!current || !character || !workPath || running.current) return;
    const draft = selectTab(current, tab);
    if (!hasValues(draft.values)) return;
    running.current = true;
    setSaving(true);
    setError('');
    try {
      const values = empty();
      const expected = empty();
      for (const section of groups) {
        for (const [key, original] of Object.entries(draft.values[section])) {
          const value = section === 'development' ? original : original.trim();
          const before = (draft.expected[section] as Record<string, string>)[key] ?? '';
          if (value === before) continue;
          (values[section] as Record<string, string>)[key] = value;
          (expected[section] as Record<string, string>)[key] = before;
        }
      }
      if (groups.some((section) => Object.keys(values[section]).length))
        await window.electron.ipcRenderer.invoke(
          'db-character-patch-profile-draft',
          workPath,
          character.id,
          values.design,
          expected.design,
          {
            voice: values.voice,
            voiceExpected: expected.voice,
            development: values.development,
            developmentExpected: expected.development,
          }
        );
      clearSelected(draft);
      // 手动新增到 AI 草稿的条目，等作者实际保存此页后才启动后台关联。
      const person: EnrichmentPerson = {
        ...character,
        design: { ...character.design, ...values.design } as CharacterDesign,
        development: { ...character.development, ...values.development },
        chapters,
      };
      for (const entry of developmentEntries(values.development)) {
        if (
          !expected.development[entry.id] &&
          entry.events.length === 1 &&
          entry.events[0].source === 'manual'
        )
          enrichSavedEntry(workPath, person, values.development[entry.id]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      running.current = false;
      setSaving(false);
    }
  };
  return {
    baseline: draft?.expected,
    values: draft?.values.design,
    voice: draft?.values.voice,
    development: draft?.values.development,
    hasDraft: !!draft,
    hasTabDraft,
    fill,
    edit,
    editVoice,
    editDevelopment,
    discard,
    save,
    saving,
    error,
  };
}
