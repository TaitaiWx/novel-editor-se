import React, { useState } from 'react';
import type { GrowthEventInput, GrowthEventType, GrowthRuleset } from '@novel-editor/core/growth';
import styles from './styles.module.scss';

type FormEventType = Exclude<GrowthEventType, 'choice'>;

const TYPE_LABELS: Record<FormEventType, string> = {
  exp: '经验',
  attribute: '属性',
  skill: '技能升级',
  'skill-exp': '技能经验',
  level: '等级',
  note: '备注',
};

const TYPE_HINTS: Record<FormEventType, string> = {
  exp: '获得经验会按规则自动升级，并按每级成长增加属性',
  attribute: '直接调整属性，超过上限或下限会被拦截',
  skill: '学习或提升技能等级，会检查前置条件与互斥组',
  'skill-exp': '累积技能经验，达到消耗时自动升级',
  level: '剧情直接改变等级（传承、降级诅咒等）',
  note: '只记录一条剧情备注，不改变数值',
};

interface GrowthEventFormProps {
  ruleset: GrowthRuleset;
  busy: boolean;
  defaultChapter?: number;
  /** 返回错误文案，成功返回 null */
  onSubmit: (event: GrowthEventInput, force: boolean) => Promise<string | null>;
}

/**
 * 记录一笔成长：经验 / 属性 / 技能 / 等级 / 备注。违反规则时允许作者「仍然记录」。
 */
export const GrowthEventForm: React.FC<GrowthEventFormProps> = ({
  ruleset,
  busy,
  defaultChapter,
  onSubmit,
}) => {
  const [type, setType] = useState<FormEventType>('exp');
  const [target, setTarget] = useState('');
  const [delta, setDelta] = useState('');
  const [chapter, setChapter] = useState(defaultChapter ? String(defaultChapter) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsTarget = type === 'attribute' || type === 'skill' || type === 'skill-exp';
  const needsDelta = type !== 'note';
  const targets =
    type === 'attribute'
      ? ruleset.attributes.map((attr) => ({ value: attr.key, label: attr.name }))
      : ruleset.skills.map((skill) => ({ value: skill.id, label: skill.name }));

  const build = (): GrowthEventInput | string => {
    if (needsTarget && !target) return type === 'attribute' ? '请选择属性' : '请选择技能';
    const chapterNum = chapter.trim() === '' ? undefined : Number(chapter);
    if (chapterNum !== undefined && (!Number.isInteger(chapterNum) || chapterNum < 0)) {
      return '章节号必须是非负整数';
    }
    let deltaNum: number | undefined;
    if (needsDelta) {
      if (delta.trim() === '') {
        if (type === 'skill' || type === 'level') deltaNum = 1;
        else return '请填写数值';
      } else {
        deltaNum = Number(delta);
        if (!Number.isFinite(deltaNum)) return '数值必须是数字';
      }
    }
    if (type === 'note' && !note.trim()) return '请填写备注内容';
    return {
      type,
      ...(needsTarget ? { target } : {}),
      ...(deltaNum !== undefined ? { delta: deltaNum } : {}),
      ...(chapterNum !== undefined ? { chapter: chapterNum } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
  };

  const submit = async (force: boolean) => {
    const event = build();
    if (typeof event === 'string') {
      setError(event);
      return;
    }
    const result = await onSubmit(event, force);
    setError(result);
    if (!result) {
      // 成功后清空数值与原因；章节保留（作者常在同一章连续记录多笔成长）
      setDelta('');
      setNote('');
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <div className={styles.typeRow} role="tablist" aria-label="成长类型">
        {(Object.keys(TYPE_LABELS) as FormEventType[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={type === key}
            className={`${styles.typeButton} ${type === key ? styles.typeActive : ''}`}
            title={TYPE_HINTS[key]}
            onClick={() => {
              setType(key);
              setTarget('');
              setError(null);
            }}
          >
            {TYPE_LABELS[key]}
          </button>
        ))}
      </div>
      <div className={styles.fields}>
        {needsTarget && (
          <select
            className={styles.input}
            value={target}
            aria-label={type === 'attribute' ? '属性' : '技能'}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">{type === 'attribute' ? '选择属性' : '选择技能'}</option>
            {targets.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        {needsDelta && (
          <input
            className={`${styles.input} ${styles.number}`}
            value={delta}
            inputMode="numeric"
            aria-label="数值"
            placeholder={type === 'skill' || type === 'level' ? '+1' : '数值'}
            onChange={(event) => setDelta(event.target.value)}
          />
        )}
        <input
          className={`${styles.input} ${styles.number}`}
          value={chapter}
          inputMode="numeric"
          aria-label="章节"
          placeholder="第几章"
          title="记录发生的章节，用于暴涨检查与配角提醒"
          // 聚焦时全选，方便直接输入新章节号覆盖
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setChapter(event.target.value)}
        />
      </div>
      <div className={styles.fields}>
        <input
          className={`${styles.input} ${styles.grow}`}
          value={note}
          aria-label="备注"
          placeholder={type === 'note' ? '备注内容' : '剧情原因（可选）'}
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" className={styles.primary} disabled={busy}>
          记录
        </button>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button
            type="button"
            className={styles.forceButton}
            disabled={busy}
            title="违反规则时仍然写入，并在一致性检查中保留警告"
            onClick={() => void submit(true)}
          >
            仍然记录
          </button>
        </div>
      )}
    </form>
  );
};

export default GrowthEventForm;
