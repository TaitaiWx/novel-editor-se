import React, { useEffect, useRef, useState } from 'react';
import type {
  GrowthEventInput,
  GrowthEventType,
  GrowthRuleset,
  GrowthSheet,
} from '@novel-editor/core/growth';
import { HelpTip } from '../HelpTip';
import { GROWTH_TIPS } from '../growthGuide';
import Select from '../../../Select';
import styles from './styles.module.scss';

export type RecordType = Exclude<GrowthEventType, 'choice'>;

/** 常用的 4 种；技能经验 / 直接调整等级收在「高级」里 */
const MAIN_TYPES: Array<[RecordType, string]> = [
  ['exp', '获得经验'],
  ['attribute', '属性变化'],
  ['skill', '技能'],
  ['note', '记事'],
];
const ADVANCED_TYPES: Array<[RecordType, string]> = [
  ['skill-exp', '技能经验'],
  ['level', '直接调整等级'],
];

const VALUE_LABELS: Partial<Record<RecordType, { label: string; placeholder: string }>> = {
  exp: { label: '获得多少经验', placeholder: '如：300（扣除写 -50）' },
  attribute: { label: '变化多少', placeholder: '如：+2 或 -1' },
  'skill-exp': { label: '技能经验', placeholder: '如：150' },
  level: { label: '等级变化', placeholder: '如：+1 或 -1' },
};

const NOTE_PLACEHOLDERS: Record<RecordType, string> = {
  exp: '如：击败狼王',
  attribute: '如：服下灵果',
  skill: '如：随师父闭关三日',
  'skill-exp': '如：每日练剑',
  level: '如：继承师门传承',
  note: '如：左臂受伤，三章内不能用剑',
};

export interface GrowthRecordFormProps {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
  busy: boolean;
  /** 默认章节（当前打开的章节，其次是最近记录的章节） */
  defaultChapter?: number;
  /** 默认章节的来源，用于提示 */
  chapterSource?: 'current' | 'latest' | null;
  /** 返回错误文案，成功返回 null */
  onSubmit: (event: GrowthEventInput, force: boolean) => Promise<string | null>;
  onCancel?: () => void;
  /** 写入成功后（例如关闭弹层） */
  onDone?: () => void;
}

function parseNumber(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/[\uff0b]/g, '+')
    .replace(/[\uff0d\u2014]/g, '-')
    .replace(/\s+/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * 「记一笔」：选类型 → 填一个数值（可写一句发生了什么）→ Enter。
 * 违反规则时显示原因，并允许「仍然记录」。
 */
export const GrowthRecordForm: React.FC<GrowthRecordFormProps> = ({
  ruleset,
  sheet,
  busy,
  defaultChapter,
  chapterSource = null,
  onSubmit,
  onCancel,
  onDone,
}) => {
  const [type, setType] = useState<RecordType>('exp');
  const [target, setTarget] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [chapter, setChapter] = useState(defaultChapter ? String(defaultChapter) : '');
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null);

  // 切换类型后把焦点放到第一个输入框，保证「选类型 → 输入 → Enter」一气呵成
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [type]);

  const valueSpec = VALUE_LABELS[type];
  const needsAttribute = type === 'attribute';
  const needsSkill = type === 'skill' || type === 'skill-exp';
  const isNote = type === 'note';

  const build = (): GrowthEventInput | string => {
    if (needsAttribute && !target) return '请选择属性';
    if (needsSkill && !target) return '请选择技能';
    const chapterText = chapter.trim();
    const chapterNum = chapterText === '' ? undefined : Number(chapterText);
    if (chapterNum !== undefined && (!Number.isInteger(chapterNum) || chapterNum < 0)) {
      return '章节号必须是非负整数';
    }
    let delta: number | undefined;
    if (valueSpec) {
      const parsed = parseNumber(value);
      if (parsed === null) return value.trim() ? '数值必须是数字，例如 300 或 -2' : '请填写数值';
      if (parsed === 0) return '数值不能为 0';
      delta = parsed;
    } else if (type === 'skill') {
      delta = 1;
    }
    if (isNote && !note.trim()) return '请写下要记的事';
    return {
      type,
      ...(needsAttribute || needsSkill ? { target } : {}),
      ...(delta !== undefined ? { delta } : {}),
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
      setValue('');
      setNote('');
      onDone?.();
    }
  };

  const chooseType = (next: RecordType) => {
    setType(next);
    setTarget('');
    setValue('');
    setError(null);
  };

  const knownSkill = (id: string) =>
    sheet.skills.find((skill) => skill.id === id && skill.level > 0) ?? null;

  const bindFirst = (node: HTMLInputElement | HTMLButtonElement | null) => {
    firstFieldRef.current = node;
  };

  return (
    <form
      className={styles.form}
      aria-label={`为 ${sheet.name} 记一笔`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onCancel) {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className={styles.typeRow}>
        <div className={styles.types} role="tablist" aria-label="记录类型">
          {MAIN_TYPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={type === key}
              className={styles.type}
              onClick={() => chooseType(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <HelpTip text={GROWTH_TIPS[type]} label="这类记录的说明" />
      </div>

      {(needsAttribute || needsSkill) && (
        <label className={styles.field}>
          <span className={styles.label}>{needsAttribute ? '哪项属性' : '哪个技能'}</span>
          <Select
            ref={bindFirst}
            block
            value={target}
            aria-label={needsAttribute ? '属性' : '技能'}
            placeholder={needsAttribute ? '选择属性…' : '选择技能…'}
            options={
              needsAttribute
                ? ruleset.attributes.map((attr) => ({
                    value: attr.key,
                    label: `${attr.name}（当前 ${sheet.attributes[attr.key] ?? attr.initial}）`,
                  }))
                : ruleset.skills.map((skill) => {
                    const known = knownSkill(skill.id);
                    const suffix =
                      type === 'skill-exp'
                        ? known
                          ? `Lv.${known.level}`
                          : '未学会'
                        : known
                          ? `Lv.${known.level} → ${known.level + 1}`
                          : '学会';
                    return { value: skill.id, label: `${skill.name}（${suffix}）` };
                  })
            }
            onChange={setTarget}
          />
        </label>
      )}

      {valueSpec && (
        <label className={styles.field}>
          <span className={styles.label}>{valueSpec.label}</span>
          <input
            ref={needsAttribute || needsSkill ? undefined : bindFirst}
            className={styles.input}
            value={value}
            inputMode="numeric"
            aria-label={valueSpec.label}
            placeholder={valueSpec.placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      )}

      <label className={styles.field}>
        <span className={styles.label}>{isNote ? '记下什么' : '发生了什么（可选）'}</span>
        <input
          ref={isNote ? bindFirst : undefined}
          className={styles.input}
          value={note}
          aria-label={isNote ? '记事内容' : '发生了什么'}
          placeholder={NOTE_PLACEHOLDERS[type]}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <div className={styles.footer}>
        <label className={styles.chapter}>
          <span>第</span>
          <input
            className={styles.chapterInput}
            value={chapter}
            inputMode="numeric"
            aria-label="章节"
            placeholder="?"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setChapter(event.target.value)}
          />
          <span>章</span>
          {chapterSource && chapter === String(defaultChapter ?? '') && (
            <span className={styles.chapterHint}>
              {chapterSource === 'current' ? '当前章节' : '上次记录'}
            </span>
          )}
        </label>
        <button
          type="button"
          className={styles.advancedToggle}
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
        >
          高级
        </button>
        <span className={styles.spacer} />
        {onCancel && (
          <button type="button" className={styles.cancel} onClick={onCancel}>
            取消
          </button>
        )}
        <button type="submit" className={styles.submit} disabled={busy}>
          记下
        </button>
      </div>

      {advanced && (
        <div className={styles.advanced} role="group" aria-label="高级记录类型">
          {ADVANCED_TYPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={type === key}
              className={styles.type}
              onClick={() => chooseType(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button
            type="button"
            className={styles.force}
            disabled={busy}
            title="违反规则时仍然写入，提醒中会保留这条记录"
            onClick={() => void submit(true)}
          >
            仍然记录
          </button>
        </div>
      )}
    </form>
  );
};

export default GrowthRecordForm;
