import React, { useState } from 'react';
import { VscClose, VscTrash } from 'react-icons/vsc';
import {
  createCoreRuleDraft,
  type CoreRule,
  type CoreRuleCheck,
  type GrowthRuleset,
} from '@novel-editor/core/growth';
import NumberInput from '../../../NumberInput';
import { defaultCheck, type CheckKind } from './model';
import Select from '../../../Select';
import {
  FieldIssue,
  IconButton,
  TextField,
  countErrorsUnder,
  replaceAt,
  type RulesSectionProps,
} from './fields';
import { RulesSection } from './RulesSection';
import styles from './styles.module.scss';

const CHECK_OPTIONS: Array<{ value: CheckKind; label: string; description: string }> = [
  { value: 'none', label: '交给 AI 遵守', description: '不做自动校验，AI 推演时遵守' },
  { value: 'max-level', label: '等级上限', description: '角色等级不能超过' },
  { value: 'max-attribute', label: '属性上限', description: '某项属性不能超过' },
  { value: 'max-skill-level', label: '技能等级上限', description: '某个技能不能超过' },
  { value: 'forbid-skill', label: '禁用技能', description: '不能学会某个技能' },
  {
    value: 'require-choice-by-level',
    label: '限期抉择',
    description: '到达某等级前必须完成抉择',
  },
];

interface CheckParamsProps {
  ruleset: GrowthRuleset;
  check: CoreRuleCheck;
  label: string;
  disabled: boolean;
  onChange: (check: CoreRuleCheck) => void;
}

/** 自动校验的参数：属性 / 技能 / 抉择用下拉，数值用数字输入 */
const CheckParams: React.FC<CheckParamsProps> = ({ ruleset, check, label, disabled, onChange }) => {
  const attrOptions = ruleset.attributes.map((attr) => ({
    value: attr.key,
    label: attr.name || attr.key,
  }));
  const skillOptions = ruleset.skills.map((skill) => ({
    value: skill.id,
    label: skill.name || skill.id,
  }));
  const groupOptions = ruleset.choiceGroups.map((group) => ({
    value: group.id,
    label: group.name || group.id,
  }));
  const number = (value: number, aria: string, apply: (value: number) => void, min = 0) => (
    <NumberInput
      size="sm"
      className={styles.pairNumber}
      aria-label={`${label} ${aria}`}
      value={value}
      min={min}
      disabled={disabled}
      onChange={apply}
    />
  );
  switch (check.kind) {
    case 'max-level':
      return (
        <>
          <span className={styles.pairText}>不超过</span>
          {number(check.value, '等级上限', (value) => onChange({ ...check, value }), 1)}
          <span className={styles.pairText}>级</span>
        </>
      );
    case 'max-attribute':
      return (
        <>
          <Select
            size="sm"
            aria-label={`${label} 限制的属性`}
            value={check.key}
            placeholder="选择属性"
            options={attrOptions}
            disabled={disabled}
            onChange={(key) => onChange({ ...check, key })}
          />
          <span className={styles.pairText}>不超过</span>
          {number(check.value, '属性上限', (value) => onChange({ ...check, value }), -9999)}
        </>
      );
    case 'max-skill-level':
      return (
        <>
          <Select
            size="sm"
            aria-label={`${label} 限制的技能`}
            value={check.skillId}
            placeholder="选择技能"
            options={skillOptions}
            disabled={disabled}
            onChange={(skillId) => onChange({ ...check, skillId })}
          />
          <span className={styles.pairText}>不超过</span>
          {number(check.value, '技能等级上限', (value) => onChange({ ...check, value }))}
          <span className={styles.pairText}>级</span>
        </>
      );
    case 'forbid-skill':
      return (
        <Select
          size="sm"
          aria-label={`${label} 禁用的技能`}
          value={check.skillId}
          placeholder="选择技能"
          options={skillOptions}
          disabled={disabled}
          onChange={(skillId) => onChange({ ...check, skillId })}
        />
      );
    case 'require-choice-by-level':
      return (
        <>
          <Select
            size="sm"
            aria-label={`${label} 需要完成的抉择`}
            value={check.groupId}
            placeholder="选择抉择"
            options={groupOptions}
            disabled={disabled}
            onChange={(groupId) => onChange({ ...check, groupId })}
          />
          <span className={styles.pairText}>须在</span>
          {number(check.level, '截止等级', (level) => onChange({ ...check, level }), 1)}
          <span className={styles.pairText}>级前完成</span>
        </>
      );
    default:
      return null;
  }
};

interface CoreRulesSectionProps extends RulesSectionProps {
  /** 可以限定适用范围的角色 */
  characterNames: readonly string[];
}

/** 核心规则：文字规则 + 可选的自动校验 + 适用角色 */
export const CoreRulesSection: React.FC<CoreRulesSectionProps> = ({
  draft,
  update,
  issues,
  disabled,
  characterNames,
}) => {
  const [text, setText] = useState('');
  const patch = (index: number, next: CoreRule) =>
    update((ruleset) => ({ ...ruleset, coreRules: replaceAt(ruleset.coreRules, index, next) }));
  const add = () => {
    const value = text.trim();
    if (!value) return;
    update((ruleset) => ({
      ...ruleset,
      coreRules: [...ruleset.coreRules, createCoreRuleDraft(ruleset, value)],
    }));
    setText('');
  };

  return (
    <RulesSection
      title="核心规则"
      meta={`${draft.coreRules.length} 条`}
      errorCount={countErrorsUnder(issues, 'coreRules')}
      testId="growth-rules-core"
    >
      {draft.coreRules.length === 0 && (
        <div className={styles.empty}>写下不可违背的设定，例如「主角在第三卷前不能学会飞行」</div>
      )}
      {draft.coreRules.map((rule, index) => {
        const base = `coreRules.${index}`;
        const label = `规则 ${index + 1}`;
        const applies = rule.appliesTo ?? [];
        const freeNames = characterNames.filter((name) => !applies.includes(name));
        const setApplies = (names: string[]) => {
          const next: CoreRule = { ...rule, appliesTo: names };
          if (names.length === 0) delete next.appliesTo;
          patch(index, next);
        };
        return (
          <div key={rule.id} className={styles.item} aria-label={`核心${label}`}>
            <div className={styles.itemRow}>
              <TextField
                className={styles.grow}
                label={label}
                ariaLabel={`${label} 内容`}
                value={rule.text}
                disabled={disabled}
                issues={issues}
                path={`${base}.text`}
                onChange={(value) => patch(index, { ...rule, text: value })}
              />
              <div className={styles.itemActions}>
                <IconButton
                  label={`删除${label}`}
                  danger
                  disabled={disabled}
                  onClick={() =>
                    update((ruleset) => ({
                      ...ruleset,
                      coreRules: ruleset.coreRules.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <VscTrash />
                </IconButton>
              </div>
            </div>
            <div className={styles.pairRow}>
              <Select<CheckKind>
                size="sm"
                aria-label={`${label} 自动校验`}
                value={rule.check?.kind ?? 'none'}
                options={CHECK_OPTIONS}
                disabled={disabled}
                onChange={(kind) => {
                  const check = defaultCheck(kind, draft);
                  const next: CoreRule = { ...rule };
                  if (check) next.check = check;
                  else delete next.check;
                  patch(index, next);
                }}
              />
              {rule.check && (
                <CheckParams
                  ruleset={draft}
                  check={rule.check}
                  label={label}
                  disabled={disabled}
                  onChange={(check) => patch(index, { ...rule, check })}
                />
              )}
            </div>
            <FieldIssue issues={issues} path={`${base}.check`} />
            <div className={styles.chips}>
              <span className={styles.pairText}>适用</span>
              {applies.length === 0 && <span className={styles.pairText}>所有角色</span>}
              {applies.map((name) => (
                <span key={name} className={styles.chip}>
                  {name}
                  <IconButton
                    label={`${label} 不再限定 ${name}`}
                    disabled={disabled}
                    onClick={() => setApplies(applies.filter((item) => item !== name))}
                  >
                    <VscClose />
                  </IconButton>
                </span>
              ))}
              {freeNames.length > 0 && (
                <Select
                  size="sm"
                  aria-label={`${label} 限定角色`}
                  value=""
                  placeholder="+ 只对某个角色"
                  options={freeNames.map((name) => ({ value: name, label: name }))}
                  disabled={disabled}
                  onChange={(name) => setApplies([...applies, name])}
                />
              )}
            </div>
          </div>
        );
      })}
      <form
        className={styles.addRow}
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className={`${styles.input} ${styles.grow}`}
          value={text}
          placeholder="新增一条核心规则"
          aria-label="新增核心规则"
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className={styles.button} disabled={disabled || !text.trim()}>
          添加
        </button>
      </form>
    </RulesSection>
  );
};

export default CoreRulesSection;
