import React, { useMemo, useState } from 'react';
import { VscAdd, VscTrash } from 'react-icons/vsc';
import { createSkillDraft, expandSkillCosts, type SkillDef } from '@novel-editor/core/growth';
import { ExclusiveGroupField } from './ExclusiveGroupField';
import {
  FieldIssue,
  IconButton,
  NumberField,
  TextField,
  countErrorsUnder,
  replaceAt,
  type RequestRemove,
  type RulesSectionProps,
} from './fields';
import { RulesSection } from './RulesSection';
import { SkillPrerequisitesEditor } from './SkillPrerequisites';
import styles from './styles.module.scss';

interface SkillsSectionProps extends RulesSectionProps {
  onRemove: RequestRemove;
}

/** 技能：名称、说明、最高等级、每级升级经验、前置条件、互斥组 */
export const SkillsSection: React.FC<SkillsSectionProps> = ({
  draft,
  update,
  issues,
  disabled,
  onRemove,
}) => {
  const [focusId, setFocusId] = useState<string | null>(null);
  const groups = useMemo(
    () =>
      [...new Set(draft.skills.map((skill) => skill.exclusiveGroup).filter(Boolean))] as string[],
    [draft.skills]
  );
  const patch = (index: number, changes: Partial<SkillDef>) =>
    update((ruleset) => {
      const next = { ...ruleset.skills[index], ...changes };
      for (const key of Object.keys(changes) as Array<keyof SkillDef>) {
        if (changes[key] === undefined) delete next[key];
      }
      return { ...ruleset, skills: replaceAt(ruleset.skills, index, next) };
    });
  const add = () => {
    const created = createSkillDraft(draft);
    setFocusId(created.id);
    update((ruleset) => ({ ...ruleset, skills: [...ruleset.skills, created] }));
  };

  return (
    <RulesSection
      title="技能"
      meta={`${draft.skills.length} 个`}
      errorCount={countErrorsUnder(issues, 'skills')}
      testId="growth-rules-skills"
      actions={
        <button type="button" className={styles.button} disabled={disabled} onClick={add}>
          <VscAdd aria-hidden /> 添加技能
        </button>
      }
    >
      {draft.skills.length === 0 && <div className={styles.empty}>还没有技能</div>}
      {draft.skills.map((skill, index) => {
        const base = `skills.${index}`;
        const label = skill.name.trim() || `技能 ${index + 1}`;
        const costs = expandSkillCosts(skill);
        return (
          <div key={skill.id} className={styles.item} aria-label={`技能 ${label}`}>
            <div className={styles.itemRow}>
              <TextField
                className={styles.grow}
                label="名称"
                ariaLabel={`技能 ${index + 1} 名称`}
                value={skill.name}
                placeholder="例如 火球术"
                autoFocus={focusId === skill.id}
                disabled={disabled}
                issues={issues}
                path={`${base}.name`}
                onChange={(name) => patch(index, { name })}
              />
              <div className={styles.narrow}>
                <NumberField
                  label="最高等级"
                  ariaLabel={`${label} 最高等级`}
                  value={skill.maxLevel}
                  min={1}
                  max={99}
                  disabled={disabled}
                  issues={issues}
                  path={`${base}.maxLevel`}
                  onChange={(maxLevel) =>
                    patch(index, {
                      maxLevel,
                      costPerLevel: expandSkillCosts({ ...skill, maxLevel }),
                    })
                  }
                />
              </div>
              <div className={styles.groupField}>
                <ExclusiveGroupField
                  label={label}
                  value={skill.exclusiveGroup}
                  groups={groups}
                  disabled={disabled}
                  onChange={(exclusiveGroup) => patch(index, { exclusiveGroup })}
                />
              </div>
              <div className={styles.itemActions}>
                <IconButton
                  label={`删除技能 ${label}`}
                  danger
                  disabled={disabled}
                  onClick={() => onRemove({ kind: 'skill', id: skill.id }, `技能「${label}」`)}
                >
                  <VscTrash />
                </IconButton>
              </div>
            </div>
            <input
              className={`${styles.input} ${styles.description}`}
              aria-label={`${label} 说明`}
              placeholder="一句话说明（可选）"
              value={skill.description ?? ''}
              disabled={disabled}
              onChange={(event) => patch(index, { description: event.target.value || undefined })}
            />
            <div className={styles.subBlock}>
              <div className={styles.subTitle}>每级升级经验</div>
              <div className={styles.numberGrid}>
                {costs.map((cost, level) => (
                  <NumberField
                    key={level}
                    label={level === 0 ? '学会' : `${level} → ${level + 1}`}
                    ariaLabel={`${label} ${level} 级升 ${level + 1} 级经验`}
                    value={cost}
                    min={0}
                    disabled={disabled}
                    issues={issues}
                    path={`${base}.costPerLevel.${level}`}
                    onChange={(value) =>
                      patch(index, { costPerLevel: replaceAt(costs, level, value) })
                    }
                  />
                ))}
              </div>
              <FieldIssue issues={issues} path={`${base}.costPerLevel`} />
            </div>
            <SkillPrerequisitesEditor
              ruleset={draft}
              skill={skill}
              base={base}
              issues={issues}
              disabled={disabled}
              onChange={(prerequisites) => patch(index, { prerequisites })}
            />
          </div>
        );
      })}
    </RulesSection>
  );
};

export default SkillsSection;
