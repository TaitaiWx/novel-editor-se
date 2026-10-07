import React, { useEffect, useState } from 'react';
import {
  CHARACTER_DESIGN_FIELDS,
  parseCharacterDesign,
  type CharacterDesign,
} from '@novel-editor/core/entity-media';
import styles from './styles.module.scss';

interface CharacterDesignFormProps {
  design: CharacterDesign | undefined;
  onSave: (design: CharacterDesign) => Promise<void> | void;
}

/**
 * 人物设计：外貌、服装、性格、背景、说话方式。每个字段失焦即保存。
 * AI 出图（三视图 / 形象图）只读外貌与服装；续写、场景视频读取全部字段，保证人物前后一致。
 */
export const CharacterDesignForm: React.FC<CharacterDesignFormProps> = ({ design, onSave }) => {
  const [draft, setDraft] = useState<CharacterDesign>(() => parseCharacterDesign(design));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const designKey = JSON.stringify(design ?? null);
  // 只在外部数据变化时同步（保存后重新加载），按序列化结果比较避免每次渲染重置草稿
  useEffect(() => {
    setDraft(parseCharacterDesign(JSON.parse(designKey) as unknown));
  }, [designKey]);

  const commit = async (key: keyof CharacterDesign) => {
    const current = parseCharacterDesign(design);
    if (current[key] === draft[key].trim()) return;
    await onSave({ ...current, [key]: draft[key].trim() });
    setSavedAt(new Date().toLocaleTimeString());
  };

  return (
    <div className={styles.form} data-testid="character-design">
      <p className={styles.hint}>
        写几句就够：AI 出图、续写和场景视频都会读取这里，人物不容易「崩」。
        {savedAt && <span className={styles.saved}>已保存 {savedAt}</span>}
      </p>
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
              setDraft((prev) => ({ ...prev, [field.key]: value }));
            }}
            onBlur={() => void commit(field.key)}
          />
        </label>
      ))}
    </div>
  );
};

export default CharacterDesignForm;
