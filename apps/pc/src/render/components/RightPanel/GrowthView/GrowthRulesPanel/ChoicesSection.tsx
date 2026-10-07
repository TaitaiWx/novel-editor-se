import React from 'react';
import { VscAdd, VscTrash } from 'react-icons/vsc';
import {
  createChoiceGroupDraft,
  createChoiceOptionDraft,
  type ChoiceGroup,
} from '@novel-editor/core/growth';
import { ChoiceOptionEditor } from './ChoiceOptionEditor';
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
import styles from './styles.module.scss';

interface ChoicesSectionProps extends RulesSectionProps {
  onRemove: RequestRemove;
}

/** 能力抉择（二选一 / 三选一）：名称、建议等级、可选数量、选项与奖励 */
export const ChoicesSection: React.FC<ChoicesSectionProps> = ({
  draft,
  update,
  issues,
  disabled,
  onRemove,
}) => {
  const patch = (index: number, changes: Partial<ChoiceGroup>) =>
    update((ruleset) => {
      const next = { ...ruleset.choiceGroups[index], ...changes };
      if ('unlockLevel' in changes && changes.unlockLevel === undefined) delete next.unlockLevel;
      if ('description' in changes && !changes.description) delete next.description;
      return { ...ruleset, choiceGroups: replaceAt(ruleset.choiceGroups, index, next) };
    });

  return (
    <RulesSection
      title="能力抉择"
      meta={`${draft.choiceGroups.length} 组`}
      errorCount={countErrorsUnder(issues, 'choiceGroups')}
      testId="growth-rules-choices"
      actions={
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          onClick={() =>
            update((ruleset) => ({
              ...ruleset,
              choiceGroups: [...ruleset.choiceGroups, createChoiceGroupDraft(ruleset)],
            }))
          }
        >
          <VscAdd aria-hidden /> 添加抉择
        </button>
      }
    >
      {draft.choiceGroups.length === 0 && (
        <div className={styles.empty}>还没有二选一 / 三选一的抉择</div>
      )}
      {draft.choiceGroups.map((group, index) => {
        const base = `choiceGroups.${index}`;
        const label = group.name.trim() || `抉择 ${index + 1}`;
        return (
          <div key={group.id} className={styles.item} aria-label={`抉择 ${label}`}>
            <div className={styles.itemRow}>
              <TextField
                className={styles.grow}
                label={`名称（${group.options.length} 选 ${group.pick}）`}
                ariaLabel={`抉择 ${index + 1} 名称`}
                value={group.name}
                placeholder="例如 道途抉择"
                disabled={disabled}
                issues={issues}
                path={`${base}.name`}
                onChange={(name) => patch(index, { name })}
              />
              <div className={styles.narrow}>
                <NumberField
                  label="选几项"
                  ariaLabel={`${label} 可选数量`}
                  value={group.pick}
                  min={1}
                  max={Math.max(1, group.options.length)}
                  disabled={disabled}
                  issues={issues}
                  path={`${base}.pick`}
                  onChange={(pick) => patch(index, { pick })}
                />
              </div>
              <div className={styles.narrow}>
                <NumberField
                  label="建议等级"
                  ariaLabel={`${label} 建议等级`}
                  value={group.unlockLevel ?? null}
                  min={1}
                  allowEmpty
                  placeholder="不限"
                  disabled={disabled}
                  issues={issues}
                  path={`${base}.unlockLevel`}
                  onChange={(unlockLevel) => patch(index, { unlockLevel })}
                  onClear={() => patch(index, { unlockLevel: undefined })}
                />
              </div>
              <div className={styles.itemActions}>
                <IconButton
                  label={`删除抉择 ${label}`}
                  danger
                  disabled={disabled}
                  onClick={() =>
                    onRemove({ kind: 'choice-group', id: group.id }, `抉择「${label}」`)
                  }
                >
                  <VscTrash />
                </IconButton>
              </div>
            </div>
            <input
              className={`${styles.input} ${styles.description}`}
              aria-label={`${label} 说明`}
              placeholder="什么时候、为什么要做这个选择（可选）"
              value={group.description ?? ''}
              disabled={disabled}
              onChange={(event) => patch(index, { description: event.target.value })}
            />
            <FieldIssue issues={issues} path={`${base}.options`} />
            <div className={styles.options}>
              {group.options.map((option, optionIndex) => (
                <ChoiceOptionEditor
                  key={option.id}
                  ruleset={draft}
                  option={option}
                  index={optionIndex}
                  base={`${base}.options.${optionIndex}`}
                  issues={issues}
                  disabled={disabled}
                  canRemove={group.options.length > 1}
                  onChange={(next) =>
                    patch(index, { options: replaceAt(group.options, optionIndex, next) })
                  }
                  onRemove={() =>
                    onRemove(
                      { kind: 'choice-option', groupId: group.id, optionId: option.id },
                      `选项「${option.name.trim() || `选项 ${optionIndex + 1}`}」`
                    )
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className={styles.linkButton}
              disabled={disabled}
              onClick={() =>
                patch(index, { options: [...group.options, createChoiceOptionDraft(group)] })
              }
            >
              <VscAdd aria-hidden /> 添加选项
            </button>
          </div>
        );
      })}
    </RulesSection>
  );
};

export default ChoicesSection;
