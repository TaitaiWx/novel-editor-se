import { useUnsavedChangesGuard } from '@/render/hooks/useUnsavedChangesGuard';
import React, { useEffect, useRef, useState } from 'react';
import {
  CHARACTER_DESIGN_FIELDS,
  parseCharacterDesign,
  type CharacterDesign,
} from '@novel-editor/core/entity-media';
import styles from './styles.module.scss';

interface CharacterDesignFormProps {
  design: CharacterDesign | undefined;
  onSave: (
    patch: Partial<CharacterDesign>,
    expected: Partial<CharacterDesign>
  ) => Promise<void> | void;
}

/**
 * 人物设计：外貌、服装、性格、背景、说话方式。每个字段失焦即保存。
 * AI 出图（三视图 / 形象图）只读外貌与服装；续写、场景视频读取全部字段，保证人物前后一致。
 */
export const CharacterDesignForm: React.FC<CharacterDesignFormProps> = ({ design, onSave }) => {
  const [draft, setDraft] = useState<CharacterDesign>(() => parseCharacterDesign(design));
  const draftRef = useRef(draft);
  const baseline = useRef(parseCharacterDesign(design));
  const queue = useRef(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<keyof CharacterDesign, string>>>({});
  const incomingRef = useRef(baseline.current);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useUnsavedChangesGuard(
    pending > 0 ||
      CHARACTER_DESIGN_FIELDS.some(({ key }) => draft[key].trim() !== baseline.current[key])
  );
  const designKey = JSON.stringify(parseCharacterDesign(design));
  useEffect(() => {
    const incoming = parseCharacterDesign(JSON.parse(designKey) as unknown);
    const next = { ...draftRef.current };
    for (const { key } of CHARACTER_DESIGN_FIELDS) {
      // Only clean fields follow a refresh; dirty fields belong to the author.
      if (next[key].trim() === baseline.current[key]) {
        next[key] = incoming[key];
        baseline.current[key] = incoming[key];
      }
    }
    incomingRef.current = incoming;
    draftRef.current = next;
    setDraft(next);
  }, [designKey]);

  const commit = (key: keyof CharacterDesign) => {
    const value = draftRef.current[key].trim();
    const save = onSave; // Capture this entity's owner, including if the component unmounts.
    setPending((count) => count + 1);
    queue.current = queue.current
      .then(async () => {
        if (baseline.current[key] !== value)
          await save({ [key]: value }, { [key]: baseline.current[key] });
        baseline.current = { ...baseline.current, [key]: value };
        if (mounted.current) {
          if (draftRef.current[key].trim() === value) {
            draftRef.current = { ...draftRef.current, [key]: value };
            setDraft(draftRef.current);
          }
          setSavedAt(new Date().toLocaleTimeString());
          setErrors((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
      })
      .catch((reason: unknown) => {
        if (mounted.current)
          setErrors((current) => ({
            ...current,
            [key]: reason instanceof Error ? reason.message : '保存失败，请重试',
          }));
      })
      .finally(() => {
        if (mounted.current) setPending((count) => count - 1);
      });
  };

  return (
    <div className={styles.form} data-testid="character-design">
      <p className={styles.hint}>
        写几句就够：AI 出图、续写和场景视频都会读取这里，人物不容易「崩」。
        {savedAt && <span className={styles.saved}>已保存 {savedAt}</span>}
      </p>
      {Object.keys(errors).length > 0 && (
        <div role="alert">
          {CHARACTER_DESIGN_FIELDS.filter(({ key }) => errors[key]).map(({ key, label }) => (
            <p key={key}>
              {label}：{errors[key]}；当前已保存内容：{incomingRef.current[key] || '空'}
            </p>
          ))}
          <button
            type="button"
            onClick={() => {
              for (const { key } of CHARACTER_DESIGN_FIELDS)
                if (errors[key]) {
                  baseline.current[key] = incomingRef.current[key];
                  commit(key);
                }
            }}
          >
            重试保存
          </button>
        </div>
      )}
      {CHARACTER_DESIGN_FIELDS.map((field) => (
        <label key={field.key} className={styles.field}>
          <span className={styles.label}>{field.label}</span>
          <textarea
            className={styles.textarea}
            rows={field.key === 'background' ? 3 : 2}
            aria-label={`人物${field.label}`}
            value={draft[field.key]}
            placeholder={field.placeholder}
            onChange={(event) => {
              const value = event.target.value;
              draftRef.current = { ...draftRef.current, [field.key]: value };
              setDraft(draftRef.current);
            }}
            onBlur={() => void commit(field.key)}
          />
        </label>
      ))}
    </div>
  );
};

export default CharacterDesignForm;
