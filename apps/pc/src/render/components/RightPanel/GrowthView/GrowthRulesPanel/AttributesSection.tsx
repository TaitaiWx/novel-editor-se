import React, { useState } from 'react';
import { VscAdd, VscArrowDown, VscArrowUp, VscTrash } from 'react-icons/vsc';
import { createAttributeDraft, moveItem, type AttributeDef } from '@novel-editor/core/growth';
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

interface AttributesSectionProps extends RulesSectionProps {
  /** 已保存的属性键名：成长卡按键名记录数值，已保存的键名不可修改 */
  savedKeys: ReadonlySet<string>;
  onRemove: RequestRemove;
}

/** 属性：名称、键名、初始 / 最小 / 最大、每级成长、每级上限 */
export const AttributesSection: React.FC<AttributesSectionProps> = ({
  draft,
  update,
  issues,
  disabled,
  savedKeys,
  onRemove,
}) => {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const attributes = draft.attributes;
  const patch = (index: number, changes: Partial<AttributeDef>) =>
    update((ruleset) => ({
      ...ruleset,
      attributes: replaceAt(ruleset.attributes, index, {
        ...ruleset.attributes[index],
        ...changes,
      }),
    }));
  const move = (index: number, to: number) =>
    update((ruleset) => ({ ...ruleset, attributes: moveItem(ruleset.attributes, index, to) }));
  const add = () => {
    const created = createAttributeDraft(draft);
    setFocusKey(created.key);
    update((ruleset) => ({ ...ruleset, attributes: [...ruleset.attributes, created] }));
  };

  return (
    <RulesSection
      title="属性"
      meta={`${attributes.length} 项`}
      errorCount={countErrorsUnder(issues, 'attributes')}
      testId="growth-rules-attributes"
      actions={
        <button type="button" className={styles.button} disabled={disabled} onClick={add}>
          <VscAdd aria-hidden /> 添加属性
        </button>
      }
    >
      {attributes.length === 0 && (
        <div className={styles.empty}>还没有属性，例如「力量」「灵力」「气运」</div>
      )}
      {attributes.map((attr, index) => {
        const base = `attributes.${index}`;
        const label = attr.name.trim() || `属性 ${index + 1}`;
        const keyLocked = savedKeys.has(attr.key);
        return (
          <div key={index} className={styles.item} aria-label={`属性 ${label}`}>
            <div className={styles.itemRow}>
              <TextField
                className={styles.grow}
                label="名称"
                ariaLabel={`属性 ${index + 1} 名称`}
                value={attr.name}
                placeholder="例如 力量"
                autoFocus={focusKey === attr.key}
                disabled={disabled}
                issues={issues}
                path={`${base}.name`}
                onChange={(name) => patch(index, { name })}
              />
              <TextField
                className={styles.keyField}
                label="键名"
                ariaLabel={`属性 ${index + 1} 键名`}
                value={attr.key}
                placeholder="自动生成"
                readOnly={keyLocked}
                title={
                  keyLocked
                    ? '已保存的键名不能修改：成长卡按键名记录数值'
                    : '程序内部使用的英文标识，留空时自动生成'
                }
                disabled={disabled}
                issues={issues}
                path={`${base}.key`}
                onChange={(key) => patch(index, { key: key.trim() })}
              />
              <div className={styles.itemActions}>
                <IconButton
                  label="上移"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <VscArrowUp />
                </IconButton>
                <IconButton
                  label="下移"
                  disabled={disabled || index === attributes.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <VscArrowDown />
                </IconButton>
                <IconButton
                  label={`删除属性 ${label}`}
                  danger
                  disabled={disabled}
                  onClick={() => onRemove({ kind: 'attribute', key: attr.key }, `属性「${label}」`)}
                >
                  <VscTrash />
                </IconButton>
              </div>
            </div>
            <div className={styles.numberGrid}>
              <NumberField
                label="初始值"
                ariaLabel={`${label} 初始值`}
                value={attr.initial}
                disabled={disabled}
                issues={issues}
                path={`${base}.initial`}
                onChange={(initial) => patch(index, { initial })}
              />
              <NumberField
                label="最小"
                ariaLabel={`${label} 最小值`}
                value={attr.min}
                disabled={disabled}
                onChange={(min) => patch(index, { min })}
              />
              <NumberField
                label="最大"
                ariaLabel={`${label} 最大值`}
                value={attr.max}
                disabled={disabled}
                issues={issues}
                path={`${base}.max`}
                onChange={(max) => patch(index, { max })}
              />
              <NumberField
                label="每级成长"
                ariaLabel={`${label} 每级成长`}
                value={attr.growthPerLevel}
                disabled={disabled}
                issues={issues}
                path={`${base}.growthPerLevel`}
                onChange={(growthPerLevel) => patch(index, { growthPerLevel })}
              />
              <NumberField
                label="每级上限"
                ariaLabel={`${label} 每级上限`}
                value={attr.perLevelCap}
                min={0}
                disabled={disabled}
                issues={issues}
                path={`${base}.perLevelCap`}
                onChange={(perLevelCap) => patch(index, { perLevelCap })}
              />
            </div>
            <input
              className={`${styles.input} ${styles.description}`}
              aria-label={`${label} 说明`}
              placeholder="一句话说明（可选）"
              value={attr.description ?? ''}
              disabled={disabled}
              onChange={(event) => patch(index, { description: event.target.value || undefined })}
            />
            <FieldIssue issues={issues} path={base} />
          </div>
        );
      })}
    </RulesSection>
  );
};

export default AttributesSection;
