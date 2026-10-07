/**
 * 规则之书编辑器的共用小组件：字段问题提示、带 Tooltip 的图标按钮、带标签的数字输入
 */
import React from 'react';
import type { GrowthRuleset, RulesetIssue, RulesetRef } from '@novel-editor/core/growth';
import NumberInput from '../../../NumberInput';
import Tooltip from '../../../Tooltip';
import styles from './styles.module.scss';

/** 字段路径 → 问题列表 */
export type IssueMap = ReadonlyMap<string, RulesetIssue[]>;

export function buildIssueMap(issues: readonly RulesetIssue[]): IssueMap {
  const map = new Map<string, RulesetIssue[]>();
  for (const issue of issues) map.set(issue.path, [...(map.get(issue.path) ?? []), issue]);
  return map;
}

/** 某个前缀下（含自身）的错误数 */
export function countErrorsUnder(issues: IssueMap, prefix: string): number {
  let count = 0;
  for (const [path, list] of issues) {
    if (path === prefix || path.startsWith(`${prefix}.`)) {
      count += list.filter((issue) => issue.severity === 'error').length;
    }
  }
  return count;
}

/** 各分区共用的属性 */
export interface RulesSectionProps {
  draft: GrowthRuleset;
  update: (updater: (ruleset: GrowthRuleset) => GrowthRuleset) => void;
  issues: IssueMap;
  disabled: boolean;
}

export type RequestRemove = (ref: RulesetRef, label: string) => void;

/** 字段下方的问题提示（错误红色、提醒黄色） */
export const FieldIssue: React.FC<{ issues: IssueMap; path: string }> = ({ issues, path }) => {
  const list = issues.get(path);
  if (!list?.length) return null;
  return (
    <>
      {list.map((issue) => (
        <div
          key={issue.message}
          className={issue.severity === 'error' ? styles.fieldError : styles.fieldWarning}
          role={issue.severity === 'error' ? 'alert' : 'status'}
        >
          {issue.message}
        </div>
      ))}
    </>
  );
};

export function hasError(issues: IssueMap, path: string): boolean {
  return Boolean(issues.get(path)?.some((issue) => issue.severity === 'error'));
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}

/** 图标按钮：一律带 Tooltip 与 aria-label */
export const IconButton: React.FC<IconButtonProps> = ({
  label,
  onClick,
  disabled,
  danger,
  children,
}) => (
  <Tooltip content={label} delay={300}>
    <button
      type="button"
      className={danger ? styles.iconDanger : styles.icon}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  </Tooltip>
);

interface NumberFieldProps {
  label: string;
  /** 读屏用的完整标签，默认同 label */
  ariaLabel?: string;
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  allowEmpty?: boolean;
  onClear?: () => void;
  placeholder?: string;
  issues?: IssueMap;
  path?: string;
}

/** 上方小标签 + 数字输入 + 字段问题 */
export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  ariaLabel,
  issues,
  path,
  ...rest
}) => (
  <div className={styles.field}>
    {label && <span className={styles.fieldLabel}>{label}</span>}
    <NumberInput
      size="sm"
      block
      aria-label={ariaLabel ?? label}
      value={rest.value}
      onChange={rest.onChange}
      min={rest.min}
      max={rest.max}
      step={rest.step}
      precision={rest.precision}
      disabled={rest.disabled}
      allowEmpty={rest.allowEmpty}
      onClear={rest.onClear}
      placeholder={rest.placeholder}
    />
    {issues && path && <FieldIssue issues={issues} path={path} />}
  </div>
);

interface TextFieldProps {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  title?: string;
  autoFocus?: boolean;
  issues?: IssueMap;
  path?: string;
  className?: string;
}

/** 上方小标签 + 文本输入 + 字段问题 */
export const TextField: React.FC<TextFieldProps> = ({
  label,
  ariaLabel,
  value,
  onChange,
  issues,
  path,
  className,
  ...rest
}) => (
  <label className={`${styles.field} ${className ?? ''}`}>
    <span className={styles.fieldLabel}>{label}</span>
    <input
      className={`${styles.input} ${issues && path && hasError(issues, path) ? styles.invalid : ''}`}
      aria-label={ariaLabel ?? label}
      aria-invalid={issues && path ? hasError(issues, path) : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...rest}
    />
    {issues && path && <FieldIssue issues={issues} path={path} />}
  </label>
);

/** 用新值替换列表中的第 index 项 */
export function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item));
}

/** 重命名对象的一个键并保持顺序 */
export function renameRecordKey(
  record: Record<string, number>,
  from: string,
  to: string
): Record<string, number> {
  if (from === to || to in record) return record;
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) next[key === from ? to : key] = value;
  return next;
}
