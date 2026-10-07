import React from 'react';
import { VscAdd, VscClose, VscTrash } from 'react-icons/vsc';
import {
  grantsToRewardRows,
  rewardRowsToGrants,
  type ChoiceOption,
  type GrowthRuleset,
  type RewardRows,
} from '@novel-editor/core/growth';
import NumberInput from '../../../NumberInput';
import Select from '../../../Select';
import { FieldIssue, IconButton, TextField, replaceAt, type IssueMap } from './fields';
import styles from './styles.module.scss';

interface ChoiceOptionEditorProps {
  ruleset: GrowthRuleset;
  option: ChoiceOption;
  index: number;
  /** 字段路径，例如 choiceGroups.0.options.1 */
  base: string;
  issues: IssueMap;
  disabled: boolean;
  canRemove: boolean;
  onChange: (option: ChoiceOption) => void;
  onRemove: () => void;
}

/** 抉择的一个选项：名称、说明、奖励（属性加成行 + 获得技能） */
export const ChoiceOptionEditor: React.FC<ChoiceOptionEditorProps> = ({
  ruleset,
  option,
  index,
  base,
  issues,
  disabled,
  canRemove,
  onChange,
  onRemove,
}) => {
  const label = option.name.trim() || `选项 ${index + 1}`;
  const rows = grantsToRewardRows(option.grants);
  const setRows = (next: RewardRows) => {
    const grants = rewardRowsToGrants(next);
    const updated: ChoiceOption = { ...option };
    if (grants) updated.grants = grants;
    else delete updated.grants;
    onChange(updated);
  };
  const freeAttr = ruleset.attributes.find(
    (attr) => !rows.attributes.some((row) => row.key === attr.key)
  );
  const freeSkills = ruleset.skills.filter((skill) => !rows.skills.includes(skill.id));
  const skillName = (id: string) => ruleset.skills.find((skill) => skill.id === id)?.name || id;

  return (
    <div className={styles.option} aria-label={`选项 ${label}`}>
      <div className={styles.itemRow}>
        <TextField
          className={styles.grow}
          label={`选项 ${index + 1}`}
          ariaLabel={`选项 ${index + 1} 名称`}
          value={option.name}
          placeholder="例如 战士之道"
          disabled={disabled}
          issues={issues}
          path={`${base}.name`}
          onChange={(name) => onChange({ ...option, name })}
        />
        <div className={styles.itemActions}>
          <IconButton
            label={`删除选项 ${label}`}
            danger
            disabled={disabled || !canRemove}
            onClick={onRemove}
          >
            <VscTrash />
          </IconButton>
        </div>
      </div>
      <input
        className={`${styles.input} ${styles.description}`}
        aria-label={`${label} 说明`}
        placeholder="选择后会怎样（可选）"
        value={option.description ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const next = { ...option, description: event.target.value || undefined };
          if (!next.description) delete next.description;
          onChange(next);
        }}
      />
      <div className={styles.subTitle}>奖励</div>
      {rows.attributes.map((row, rowIndex) => (
        <div key={row.key}>
          <div className={styles.pairRow}>
            <Select
              size="sm"
              className={styles.grow}
              aria-label={`${label} 奖励属性`}
              value={row.key}
              disabled={disabled}
              options={[
                ...ruleset.attributes.map((attr) => ({
                  value: attr.key,
                  label: attr.name || attr.key,
                  disabled:
                    attr.key !== row.key && rows.attributes.some((item) => item.key === attr.key),
                })),
                ...(ruleset.attributes.some((attr) => attr.key === row.key)
                  ? []
                  : [{ value: row.key, label: row.key }]),
              ]}
              onChange={(key) =>
                setRows({
                  ...rows,
                  attributes: replaceAt(rows.attributes, rowIndex, { ...row, key }),
                })
              }
            />
            <span className={styles.pairText}>+</span>
            <NumberInput
              size="sm"
              className={styles.pairNumber}
              aria-label={`${label} 奖励数值`}
              value={row.amount}
              disabled={disabled}
              onChange={(amount) =>
                setRows({
                  ...rows,
                  attributes: replaceAt(rows.attributes, rowIndex, { ...row, amount }),
                })
              }
            />
            <IconButton
              label="移除属性加成"
              disabled={disabled}
              onClick={() =>
                setRows({ ...rows, attributes: rows.attributes.filter((_, i) => i !== rowIndex) })
              }
            >
              <VscClose />
            </IconButton>
          </div>
          <FieldIssue issues={issues} path={`${base}.grants.attributes.${row.key}`} />
        </div>
      ))}
      {rows.skills.length > 0 && (
        <div className={styles.chips}>
          {rows.skills.map((id) => (
            <span key={id} className={styles.chip}>
              学会 {skillName(id)}
              <IconButton
                label={`移除技能奖励 ${skillName(id)}`}
                disabled={disabled}
                onClick={() =>
                  setRows({ ...rows, skills: rows.skills.filter((item) => item !== id) })
                }
              >
                <VscClose />
              </IconButton>
            </span>
          ))}
        </div>
      )}
      {rows.skills.map((id) => (
        <FieldIssue key={id} issues={issues} path={`${base}.grants.skills.${id}`} />
      ))}
      <div className={styles.inlineActions}>
        <button
          type="button"
          className={styles.linkButton}
          disabled={disabled || !freeAttr}
          title={freeAttr ? undefined : '没有可选的属性'}
          onClick={() =>
            freeAttr &&
            setRows({ ...rows, attributes: [...rows.attributes, { key: freeAttr.key, amount: 1 }] })
          }
        >
          <VscAdd aria-hidden /> 属性加成
        </button>
        {freeSkills.length > 0 && (
          <Select
            size="sm"
            aria-label={`${label} 添加技能奖励`}
            value=""
            placeholder="+ 获得技能"
            disabled={disabled}
            options={freeSkills.map((skill) => ({
              value: skill.id,
              label: skill.name || skill.id,
            }))}
            onChange={(id) => setRows({ ...rows, skills: [...rows.skills, id] })}
          />
        )}
      </div>
    </div>
  );
};

export default ChoiceOptionEditor;
