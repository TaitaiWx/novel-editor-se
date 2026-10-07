import React, { useEffect, useState } from 'react';
import { parseCharacterVoice, type CharacterVoice } from '@novel-editor/video';
import Select from '../../../Select';
import styles from './styles.module.scss';

interface CharacterVoiceFormProps {
  voice: CharacterVoice | undefined;
  onSave: (voice: CharacterVoice) => Promise<void> | void;
}

type Gender = NonNullable<CharacterVoice['gender']>;
const UNSET = '__unset__';
const GENDER_OPTIONS: { value: Gender | typeof UNSET; label: string }[] = [
  { value: UNSET, label: '不指定' },
  { value: 'male', label: '男声' },
  { value: 'female', label: '女声' },
  { value: 'neutral', label: '中性' },
];

interface Draft {
  providerVoiceId: string;
  age: string;
  timbre: string;
}

function toDraft(voice: CharacterVoice | undefined): Draft {
  return {
    providerVoiceId: voice?.providerVoiceId ?? '',
    age: voice?.age ?? '',
    timbre: voice?.timbre ?? '',
  };
}

/**
 * 人物声音（可选）：场景视频为对白生成配音时使用。性别决定默认音色；填写厂商音色 id 时优先使用；
 * 年龄与音色描述会写进朗读指令（支持的服务）。每个字段失焦即保存。
 */
export const CharacterVoiceForm: React.FC<CharacterVoiceFormProps> = ({ voice, onSave }) => {
  const [draft, setDraft] = useState<Draft>(() => toDraft(voice));
  const voiceKey = JSON.stringify(voice ?? null);
  useEffect(() => {
    setDraft(toDraft(parseCharacterVoice(JSON.parse(voiceKey) as unknown)));
  }, [voiceKey]);

  const save = (patch: Partial<CharacterVoice>) => {
    const next = parseCharacterVoice({ ...voice, ...patch }) ?? {};
    if (JSON.stringify(next) === JSON.stringify(voice ?? {})) return;
    void onSave(next);
  };

  const text = (key: keyof Draft, label: string, placeholder: string) => (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        aria-label={`人物声音 ${label}`}
        value={draft[key]}
        placeholder={placeholder}
        onChange={(event) => {
          const value = event.target.value;
          setDraft((prev) => ({ ...prev, [key]: value }));
        }}
        onBlur={() => save({ [key]: draft[key].trim() || undefined })}
      />
    </label>
  );

  return (
    <section className={styles.form} aria-label="人物声音" data-testid="character-voice">
      <p className={styles.hint}>
        可选：场景视频为这个人物的台词生成配音时使用。只选性别也可以，配音服务会用对应的默认音色。
      </p>
      <label className={styles.field}>
        <span className={styles.label}>性别</span>
        <Select
          aria-label="人物声音 性别"
          value={voice?.gender ?? UNSET}
          options={GENDER_OPTIONS}
          onChange={(value) => save({ gender: value === UNSET ? undefined : value })}
        />
      </label>
      {text('age', '年龄', '例：少年 / 中年')}
      {text('timbre', '音色', '例：低沉沙哑、清亮')}
      {text('providerVoiceId', '音色 ID', '可选：配音服务的音色 id，例如 alloy')}
    </section>
  );
};

export default CharacterVoiceForm;
