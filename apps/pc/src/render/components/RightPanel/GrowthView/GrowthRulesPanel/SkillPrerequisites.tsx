import React from 'react';
import { VscAdd, VscClose } from 'react-icons/vsc';
import type { GrowthRuleset, SkillDef, SkillPrerequisites } from '@novel-editor/core/growth';
import Select from '../../../Select';
import NumberInput from '../../../NumberInput';
import { FieldIssue, IconButton, NumberField, renameRecordKey, type IssueMap } from './fields';
import styles from './styles.module.scss';

interface SkillPrerequisitesEditorProps {
  ruleset: GrowthRuleset;
  skill: SkillDef;
  /** 字段路径前缀，例如 skills.2 */
  base: string;
  issues: IssueMap;
  disabled: boolean;
  onChange: (prerequisites: SkillPrerequisites | undefined) => void;
}

/** 去掉空的部分；全部为空时返回 undefined */
function compact(pre: SkillPrerequisites): SkillPrerequisites | undefined {
  const next: SkillPrerequisites = {};
  if (pre.characterLevel !== undefined) next.characterLevel = pre.characterLevel;
  if (pre.skills && Object.keys(pre.skills).length > 0) next.skills = pre.skills;
  if (pre.attributes && Object.keys(pre.attributes).length > 0) next.attributes = pre.attributes;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** 前置条件：角色等级、前置技能（及最低等级）、属性下限 */
export const SkillPrerequisitesEditor: React.FC<SkillPrerequisitesEditorProps> = ({
  ruleset,
  skill,
  base,
  issues,
  disabled,
  onChange,
}) => {
  const pre = skill.prerequisites ?? {};
  const skillReqs = pre.skills ?? {};
  const attrReqs = pre.attributes ?? {};
  const label = skill.name.trim() || '该技能';
  const otherSkills = ruleset.skills.filter((item) => item.id !== skill.id);
  const freeSkill = otherSkills.find((item) => skillReqs[item.id] === undefined);
  const freeAttr = ruleset.attributes.find((item) => attrReqs[item.key] === undefined);
  const set = (next: SkillPrerequisites) => onChange(compact(next));

  return (
    <div className={styles.subBlock} aria-label={`${label} 的前置条件`}>
      <div className={styles.subTitle}>前置条件</div>
      <div className={styles.numberGrid}>
        <NumberField
          label="角色等级 ≥"
          ariaLabel={`${label} 需要的角色等级`}
          value={pre.characterLevel ?? null}
          min={1}
          allowEmpty
          placeholder="不限"
          disabled={disabled}
          issues={issues}
          path={`${base}.prerequisites.characterLevel`}
          onChange={(characterLevel) => set({ ...pre, characterLevel })}
          onClear={() => set({ ...pre, characterLevel: undefined })}
        />
      </div>
      {Object.entries(skillReqs).map(([id, level]) => (
        <div key={id}>
          <div className={styles.pairRow}>
            <Select
              size="sm"
              className={styles.grow}
              aria-label={`${label} 的前置技能`}
              value={id}
              disabled={disabled}
              options={[
                ...otherSkills.map((item) => ({
                  value: item.id,
                  label: item.name || item.id,
                  disabled: item.id !== id && skillReqs[item.id] !== undefined,
                })),
                ...(otherSkills.some((item) => item.id === id) ? [] : [{ value: id, label: id }]),
              ]}
              onChange={(next) => set({ ...pre, skills: renameRecordKey(skillReqs, id, next) })}
            />
            <span className={styles.pairText}>至少</span>
            <NumberInput
              size="sm"
              className={styles.pairNumber}
              aria-label={`${label} 的前置技能等级`}
              value={level}
              min={1}
              suffix="级"
              disabled={disabled}
              onChange={(value) => set({ ...pre, skills: { ...skillReqs, [id]: value } })}
            />
            <IconButton
              label="移除前置技能"
              disabled={disabled}
              onClick={() => {
                const next = { ...skillReqs };
                delete next[id];
                set({ ...pre, skills: next });
              }}
            >
              <VscClose />
            </IconButton>
          </div>
          <FieldIssue issues={issues} path={`${base}.prerequisites.skills.${id}`} />
        </div>
      ))}
      {Object.entries(attrReqs).map(([key, value]) => (
        <div key={key}>
          <div className={styles.pairRow}>
            <Select
              size="sm"
              className={styles.grow}
              aria-label={`${label} 的前置属性`}
              value={key}
              disabled={disabled}
              options={[
                ...ruleset.attributes.map((item) => ({
                  value: item.key,
                  label: item.name || item.key,
                  disabled: item.key !== key && attrReqs[item.key] !== undefined,
                })),
                ...(ruleset.attributes.some((item) => item.key === key)
                  ? []
                  : [{ value: key, label: key }]),
              ]}
              onChange={(next) => set({ ...pre, attributes: renameRecordKey(attrReqs, key, next) })}
            />
            <span className={styles.pairText}>≥</span>
            <NumberInput
              size="sm"
              className={styles.pairNumber}
              aria-label={`${label} 的属性下限`}
              value={value}
              disabled={disabled}
              onChange={(next) => set({ ...pre, attributes: { ...attrReqs, [key]: next } })}
            />
            <IconButton
              label="移除属性条件"
              disabled={disabled}
              onClick={() => {
                const next = { ...attrReqs };
                delete next[key];
                set({ ...pre, attributes: next });
              }}
            >
              <VscClose />
            </IconButton>
          </div>
          <FieldIssue issues={issues} path={`${base}.prerequisites.attributes.${key}`} />
        </div>
      ))}
      <div className={styles.inlineActions}>
        <button
          type="button"
          className={styles.linkButton}
          disabled={disabled || !freeSkill}
          title={freeSkill ? undefined : '没有可选的其他技能'}
          onClick={() => freeSkill && set({ ...pre, skills: { ...skillReqs, [freeSkill.id]: 1 } })}
        >
          <VscAdd aria-hidden /> 前置技能
        </button>
        <button
          type="button"
          className={styles.linkButton}
          disabled={disabled || !freeAttr}
          title={freeAttr ? undefined : '没有可选的属性'}
          onClick={() =>
            freeAttr &&
            set({ ...pre, attributes: { ...attrReqs, [freeAttr.key]: freeAttr.initial } })
          }
        >
          <VscAdd aria-hidden /> 属性条件
        </button>
      </div>
    </div>
  );
};

export default SkillPrerequisitesEditor;
