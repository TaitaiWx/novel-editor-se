/**
 * 预演侧栏的通用控件：单选按钮组（不用原生 select）。
 */
import React from 'react';
import styles from './styles.module.scss';

interface ChoiceProps<T extends string | number> {
  label: string;
  options: ReadonlyArray<{ id: T; label: string; hint?: string }>;
  value: T;
  onChange: (value: T) => void;
}

/** 单选按钮组（不用原生 select） */
export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: ChoiceProps<T>) {
  return (
    <div className={styles.segment} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          title={option.hint}
          className={value === option.id ? styles.choiceActive : styles.choice}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
