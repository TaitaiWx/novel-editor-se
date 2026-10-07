/**
 * 自绘复选框：替代浏览器原生的 <input type="checkbox"> 外观，与应用暗色主题统一。
 *
 * - 保留一个视觉隐藏的真实 checkbox：表单语义、Space 切换、role="checkbox" 与 `.checked` 都照常可用
 * - 自绘方框通过 `:checked` / `:indeterminate` / `:focus-visible` 兄弟选择器呈现状态，受控与非受控都无需额外状态
 * - 整个 label 都可点击；description 经 aria-describedby 关联
 */
import React, { useEffect, useId, useImperativeHandle, useRef } from 'react';
import { VscCheck, VscDash } from 'react-icons/vsc';
import styles from './styles.module.scss';

export type CheckboxSize = 'sm' | 'md';

export interface CheckboxProps {
  /** 受控选中状态 */
  checked?: boolean;
  /** 非受控初始状态 */
  defaultChecked?: boolean;
  /** 半选状态（只影响外观与 aria，点击后由使用方决定新值） */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  /** 标签文字（也可用 children） */
  label?: React.ReactNode;
  children?: React.ReactNode;
  /** 标签下方的说明文字 */
  description?: React.ReactNode;
  disabled?: boolean;
  size?: CheckboxSize;
  /** 只用于布局（外边距等），外观由组件统一提供 */
  className?: string;
  id?: string;
  name?: string;
  value?: string;
  title?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      checked,
      defaultChecked,
      indeterminate = false,
      onChange,
      label,
      children,
      description,
      disabled = false,
      size = 'md',
      className,
      id,
      name,
      value,
      title,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      'data-testid': testId,
      onFocus,
      onBlur,
    },
    forwardedRef
  ) => {
    const fallbackId = useId();
    const inputId = id ?? fallbackId;
    const descriptionId = `${inputId}-description`;
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    // indeterminate 只能通过 DOM 属性设置
    useEffect(() => {
      if (inputRef.current) inputRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    const text = label ?? children;
    const describedBy =
      [ariaDescribedBy, description ? descriptionId : undefined].filter(Boolean).join(' ') ||
      undefined;

    const rootClass = [
      styles.root,
      styles[size],
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
            ref={inputRef}
            id={inputId}
            type="checkbox"
            className={styles.input}
            checked={checked}
            defaultChecked={checked === undefined ? defaultChecked : undefined}
            disabled={disabled}
            name={name}
            value={value}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={describedBy}
            aria-checked={indeterminate ? 'mixed' : undefined}
            data-testid={testId}
            onChange={(event) => onChange?.(event.target.checked)}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <span className={styles.box} aria-hidden="true">
            <VscCheck className={styles.checkIcon} />
            <VscDash className={styles.dashIcon} />
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

Checkbox.displayName = 'Checkbox';

export default Checkbox;
