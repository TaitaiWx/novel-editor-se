import Checkbox from '@novel-editor/ui/Checkbox';
import UiInput from '@novel-editor/ui/Input';
import UiTextArea from '@novel-editor/ui/TextArea';
import UiButton from '@novel-editor/ui/Button';
import React, { useState } from 'react';
import {
  PROFILE_FIELDS,
  type ProfileCandidate,
  type ProfileApplyRequest,
} from '@novel-editor/core/character-discovery';
import type { Character } from '../RightPanel/types';
import Select from '@novel-editor/ui/Select';
import styles from './styles.module.scss';
export interface PendingProfileSuggestion {
  id: string;
  candidate: ProfileCandidate;
  roster: Character[];
  chapter: string;
  source: 'text' | 'idea';
}
export default function ProfileSuggestionCard({
  suggestion,
  busy,
  onApply,
  onDismiss,
}: {
  suggestion: PendingProfileSuggestion;
  busy: boolean;
  onApply: (request: ProfileApplyRequest) => Promise<void>;
  onDismiss: () => void;
}) {
  const { candidate, roster, chapter, source } = suggestion;
  const [target, setTarget] = useState(
    candidate.characterId === null ? 'new' : String(candidate.characterId)
  );
  const [name, setName] = useState(candidate.name);
  const [fields, setFields] = useState(
    candidate.fields.map((field) => ({ ...field, selected: true }))
  );
  const person = roster.find((c) => String(c.id) === target);
  const selected = fields.filter(
    (f) => f.selected && f.value.trim() && f.value.trim() !== (person?.design?.[f.key] ?? '')
  );
  const apply = () =>
    onApply({
      characterId: target === 'new' ? null : Number(target),
      name: target === 'new' ? name.trim() : (person?.name ?? candidate.name),
      summary: candidate.summary,
      chapter,
      source,
      quote: candidate.quote,
      changes: selected.map((f) => ({
        key: f.key,
        value: f.value.trim(),
        expected: person?.design?.[f.key] ?? '',
        quote: f.quote,
      })),
    });
  return (
    <article className={styles.card}>
      <strong>
        {candidate.name} · {candidate.characterId === null ? '发现新人物' : '补充人物资料'}
      </strong>
      <p className={styles.hint}>
        {source === 'idea' ? '创作建议，采用后才写入档案' : `正文证据 · ${chapter}`}
      </p>
      {source === 'text' && (
        <Select
          aria-label="人物建议归属"
          value={target}
          disabled={busy}
          onChange={setTarget}
          options={[
            ...(candidate.characterId === null ? [{ value: 'new', label: '创建临时配角' }] : []),
            ...roster.map((c) => ({ value: String(c.id), label: `关联已有角色 · ${c.name}` })),
          ]}
        />
      )}
      {target === 'new' && (
        <label className={styles.field}>
          姓名
          <UiInput
            unstyled
            maxLength={100}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      {candidate.summary && <p className={styles.copy}>{candidate.summary}</p>}
      {candidate.quote && <blockquote className={styles.copy}>{candidate.quote}</blockquote>}
      {fields.map((f, index) => (
        <div className={styles.change} key={f.key}>
          <Checkbox
            className={styles.check}
            checked={f.selected}
            disabled={busy}
            label={PROFILE_FIELDS.find((p) => p.key === f.key)?.label}
            onChange={(checked) =>
              setFields((items) =>
                items.map((item, i) => (i === index ? { ...item, selected: checked } : item))
              )
            }
          />
          {person?.design?.[f.key] && <p className={styles.before}>现有：{person.design[f.key]}</p>}
          <UiTextArea
            unstyled
            aria-label={`建议${PROFILE_FIELDS.find((p) => p.key === f.key)?.label}`}
            rows={3}
            maxLength={800}
            value={f.value}
            disabled={busy}
            onChange={(e) =>
              setFields((items) =>
                items.map((item, i) => (i === index ? { ...item, value: e.target.value } : item))
              )
            }
          />
          {f.quote && <blockquote className={styles.copy}>{f.quote}</blockquote>}
        </div>
      ))}
      <div className={styles.actions}>
        <UiButton unstyled type="button" disabled={busy} onClick={onDismiss}>
          忽略
        </UiButton>
        <UiButton
          unstyled
          type="button"
          disabled={busy || (target === 'new' ? !name.trim() : !selected.length || !person)}
          onClick={() => void apply()}
        >
          {target === 'new' ? '创建临时配角' : '采用选中字段'}
        </UiButton>
      </div>
    </article>
  );
}
