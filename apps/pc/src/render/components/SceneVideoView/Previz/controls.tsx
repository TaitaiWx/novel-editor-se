/**
 * 预演侧栏的通用控件：单选按钮组（不用原生 select）与带数值的滑块。
 */
import React from 'react';
import styles from './styles.module.scss';

interface ChoiceProps<T extends string | number> {
  label: string;
  options: ReadonlyArray<{ id: T; label: string; hint?: string }>;
  value: T;
  onChange: (value: T) => void;
  /** chips：可换行的小胶囊；segment：等分的分段按钮；grid：四列网格（姿势） */
  variant?: 'chips' | 'segment' | 'grid';
}

/** 单选按钮组（不用原生 select） */
export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
  variant = 'segment',
}: ChoiceProps<T>) {
  return (
    <div className={styles[variant]} role="radiogroup" aria-label={label}>
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

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}

export const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, unit, onChange }) => (
  <label className={styles.slider}>
    <span className={styles.sliderLabel}>{label}</span>
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
    <span className={styles.sliderValue}>
      {value}
      {unit}
    </span>
  </label>
);
