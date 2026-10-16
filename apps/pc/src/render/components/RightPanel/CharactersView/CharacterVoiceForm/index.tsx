import DiffTextInput from '@novel-editor/ui/DiffTextInput';
import DiffText from '@novel-editor/ui/DiffTextInput/DiffText';
import GenerationStatus, { type GenerationPhase } from '@novel-editor/ui/GenerationStatus';
import type { EnrichmentVoice } from '@novel-editor/core/character-enrichment';
import React, { useEffect, useState } from 'react';
import { parseCharacterVoice, type CharacterVoice } from '@novel-editor/video';
import Select from '@novel-editor/ui/Select';
import styles from './styles.module.scss';

interface CharacterVoiceFormProps {
  voice: CharacterVoice | undefined;
  draftOverride?: EnrichmentVoice;
  draftBaseline?: EnrichmentVoice;
  onDraftChange?: (voice: EnrichmentVoice) => void;
  disabled?: boolean;
  generationPhase?: GenerationPhase;
  onSave: (voice: CharacterVoice) => Promise<void> | void;
}

type Gender = NonNullable<CharacterVoice['gender']>;
const UNSET = '__unset__';
const genderLabel = (gender?: string) =>
  gender === 'male' ? '男' : gender === 'female' ? '女' : '不指定';
const GENDER_OPTIONS: { value: Gender | typeof UNSET; label: string }[] = [
  { value: UNSET, label: '不指定' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
];

interface Draft {
  age: string;
  timbre: string;
}

function toDraft(voice: CharacterVoice | undefined): Draft {
  return {
    age: voice?.age ?? '',
    timbre: voice?.timbre ?? '',
  };
}

/**
 * 人物基础设定：性别、年龄、音色。保留已有配音配置，界面只展示创作字段。
 * 年龄与音色描述会写进朗读指令（支持的服务）。每个字段失焦即保存。
 */
export const CharacterVoiceForm: React.FC<CharacterVoiceFormProps> = ({
  voice,
  onSave,
  draftOverride,
  draftBaseline,
  onDraftChange,
  disabled,
  generationPhase,
}) => {
  const [draft, setDraft] = useState<Draft>(() => toDraft(voice));
  const voiceKey = JSON.stringify(voice ?? null);
  useEffect(() => {
    setDraft(toDraft(parseCharacterVoice(JSON.parse(voiceKey) as unknown)));
  }, [voiceKey]);

  const save = (patch: Partial<CharacterVoice>) => {
    if (draftOverride) {
      onDraftChange?.(
        Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value ?? '']))
      );
      return;
    }
    const next = parseCharacterVoice({ ...voice, ...patch }) ?? {};
    if (JSON.stringify(next) === JSON.stringify(voice ?? {})) return;
    void onSave(next);
  };

  const text = (key: keyof Draft, label: string, placeholder: string) => (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.inputShell} aria-busy={generationPhase === 'generating'}>
        {generationPhase && generationPhase !== 'done' && (
          <span className={styles.fieldStatus}>
            <GenerationStatus phase={generationPhase} compact />
          </span>
        )}
        <DiffTextInput
          singleLine
          baseline={draftOverride ? (draftBaseline?.[key] ?? voice?.[key] ?? '') : undefined}
          disabled={disabled}
          maxLength={20}
          aria-label={`人物声音 ${label}`}
          value={draftOverride?.[key] ?? draft[key]}
          placeholder={placeholder}
          onChange={(value) => {
            if (draftOverride) {
              onDraftChange?.({ [key]: value });
              return;
            }
            setDraft((prev) => ({ ...prev, [key]: value }));
          }}
          onBlur={() => {
            if (!draftOverride) save({ [key]: draft[key].trim() || undefined });
          }}
        />
      </div>
    </label>
  );

  return (
    <section className={styles.form} aria-label="人物声音" data-testid="character-voice">
      <label className={styles.field}>
        <span className={styles.label}>性别</span>
        <div className={styles.genderControl}>
          <Select
            aria-label="人物声音 性别"
            block
            suffix={
              generationPhase && generationPhase !== 'done' ? (
                <GenerationStatus phase={generationPhase} compact />
              ) : undefined
            }
            disabled={disabled}
            value={
              (draftOverride?.gender ?? voice?.gender) === 'male'
                ? 'male'
                : (draftOverride?.gender ?? voice?.gender) === 'female'
                  ? 'female'
                  : UNSET
            }
            options={GENDER_OPTIONS}
            onChange={(value) => save({ gender: value === UNSET ? undefined : value })}
          />
          {draftOverride?.gender !== undefined &&
            draftOverride.gender !== (draftBaseline?.gender ?? voice?.gender ?? '') && (
              <span className={styles.genderDiff} aria-label="性别修改">
                <DiffText
                  before={genderLabel(draftBaseline?.gender ?? voice?.gender)}
                  value={genderLabel(draftOverride.gender)}
                />
              </span>
            )}
        </div>
      </label>
      {text('age', '年龄', '例：17 岁、约 30 岁、一百余岁')}
      <label className={`${styles.field} ${styles.multilineField}`}>
        <span className={styles.label}>音色</span>
        <div className={styles.inputShell} aria-busy={generationPhase === 'generating'}>
          {generationPhase && generationPhase !== 'done' && (
            <span className={styles.fieldStatus}>
              <GenerationStatus phase={generationPhase} compact />
            </span>
          )}
          <DiffTextInput
            baseline={draftOverride ? (draftBaseline?.timbre ?? voice?.timbre ?? '') : undefined}
            disabled={disabled}
            aria-label="人物声音 音色"
            rows={3}
            maxLength={60}
            value={draftOverride?.timbre ?? draft.timbre}
            placeholder={'例：男声，清亮、略带沙哑\n平时语速短促，安慰人时会刻意放轻声音'}
            onChange={(value) =>
              draftOverride
                ? onDraftChange?.({ timbre: value })
                : setDraft((prev) => ({ ...prev, timbre: value }))
            }
            onBlur={() => {
              if (!draftOverride) save({ timbre: draft.timbre.trim() || undefined });
            }}
          />
        </div>
      </label>
    </section>
  );
};

export default CharacterVoiceForm;
