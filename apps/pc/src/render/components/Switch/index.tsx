/**
 * 开关：用于「开 / 关」类设置，替代原生 checkbox。
 *
 * - 视觉隐藏的真实 checkbox 带 role="switch"，Space 切换、可聚焦，aria-checked 与选中状态同步
 * - 受控（checked）与非受控（defaultChecked）都支持；标签与说明文字在开关左侧或右侧
 */
import React, { useId, useState } from 'react';
import styles from './styles.module.scss';

export type SwitchSize = 'sm' | 'md' | 'lg';

export interface SwitchProps {
  /** 受控开关状态 */
  checked?: boolean;
  /** 非受控初始状态 */
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** 标签文字（也可用 children） */
  label?: React.ReactNode;
  children?: React.ReactNode;
  /** 标签下方的说明文字 */
  description?: React.ReactNode;
  /** 标签相对开关的位置，默认开关在左 */
  labelPosition?: 'start' | 'end';
  disabled?: boolean;
  size?: SwitchSize;
  /** 只用于布局（外边距等） */
  className?: string;
  id?: string;
  name?: string;
  title?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  (
    {
      checked,
      defaultChecked = false,
      onChange,
      label,
      children,
      description,
      labelPosition = 'end',
      disabled = false,
      size = 'md',
      className,
      id,
      name,
      title,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      'data-testid': testId,
      onFocus,
      onBlur,
    },
    ref
  ) => {
    const fallbackId = useId();
    const inputId = id ?? fallbackId;
    const descriptionId = `${inputId}-description`;
    // 非受控时自己记住状态，保证 aria-checked 始终准确
    const [innerChecked, setInnerChecked] = useState(defaultChecked);
    const isControlled = checked !== undefined;
    const isOn = isControlled ? checked : innerChecked;

    const text = label ?? children;
    const describedBy =
      [ariaDescribedBy, description ? descriptionId : undefined].filter(Boolean).join(' ') ||
      undefined;

    const rootClass = [
      styles.root,
      styles[size],
      labelPosition === 'start' ? styles.labelStart : '',
      disabled ? styles.disabled : '',
      description ? styles.withDescription : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <label className={rootClass} htmlFor={inputId} title={title}>
        <span className={styles.control}>
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            role="switch"
            className={styles.input}
            checked={isOn}
            disabled={disabled}
            name={name}
            aria-checked={isOn}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={describedBy}
            data-testid={testId}
            onChange={(event) => {
              const next = event.target.checked;
              if (!isControlled) setInnerChecked(next);
              onChange?.(next);
            }}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
        </span>
        {(text || description) && (
          <span className={styles.text}>
            {text && <span className={styles.label}>{text}</span>}
            {description && (
              <span id={descriptionId} className={styles.description}>
                {description}
              </span>
            )}
          </span>
        )}
      </label>
    );
  }
);

Switch.displayName = 'Switch';

export default Switch;
