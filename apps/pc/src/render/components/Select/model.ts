/** Select 的选项模型与键盘导航纯函数 */
import type React from 'react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** 首字跳转用的文本；label 不是字符串时建议提供 */
  textValue?: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectGroup<T extends string = string> {
  label: string;
  options: readonly SelectOption<T>[];
}

export type SelectItem<T extends string = string> = SelectOption<T> | SelectGroup<T>;

export function isSelectGroup<T extends string>(item: SelectItem<T>): item is SelectGroup<T> {
  return 'options' in item && Array.isArray(item.options);
}

/** 展开分组，得到按显示顺序排列的选项 */
export function flattenSelectItems<T extends string>(
  items: readonly SelectItem<T>[]
): SelectOption<T>[] {
  const result: SelectOption<T>[] = [];
  for (const item of items) {
    if (isSelectGroup(item)) result.push(...item.options);
    else result.push(item);
  }
  return result;
}

/** 从 from 起按方向找下一个可用项；到头时停在原处（没有可用项返回 -1） */
export function nextEnabledIndex<T extends string>(
  options: readonly SelectOption<T>[],
  from: number,
  direction: 1 | -1
): number {
  for (let index = from + direction; index >= 0 && index < options.length; index += direction) {
    if (!options[index].disabled) return index;
  }
  if (from >= 0 && from < options.length && !options[from].disabled) return from;
  return -1;
}

export function optionText<T extends string>(option: SelectOption<T>): string {
  if (option.textValue !== undefined) return option.textValue;
  if (typeof option.label === 'string' || typeof option.label === 'number') {
    return String(option.label);
  }
  return option.value;
}

/**
 * 首字跳转：从 from 之后循环查找文本以 query 开头的可用项。
 * 连续输入同一个字符时在同首字的选项间轮换（与原生 select 一致）
 */
export function findTypeaheadIndex<T extends string>(
  options: readonly SelectOption<T>[],
  query: string,
  from: number
): number {
  if (!query || options.length === 0) return -1;
  const normalized = query.toLocaleLowerCase();
  const repeated = Array.from(normalized).every((char) => char === normalized[0]);
  const needle = repeated ? normalized[0] : normalized;
  // 多字符查询先检查当前项是否仍然匹配，避免输入第二个字时跳走
  const start = from < 0 ? 0 : from + (repeated ? 1 : 0);
  for (let step = 0; step < options.length; step += 1) {
    const index = (start + step) % options.length;
    const option = options[index];
    if (option.disabled) continue;
    if (optionText(option).trim().toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
