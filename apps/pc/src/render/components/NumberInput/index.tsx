/**
 * 自绘数字输入框：替代原生 <input type="number">。
 *
 * - 文本框（inputMode="decimal"、role="spinbutton"）+ 右侧 − / + 步进按钮，可带单位后缀
 * - 输入时拒绝非数字字符；合法且在范围内的值实时 onChange，失焦 / Enter 时夹取到 [min, max] 并提交
 * - ↑ / ↓ 步进（按住 Shift ×10），PageUp / PageDown ×10，Home / End 跳到 min / max
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { VscAdd, VscRemove } from 'react-icons/vsc';
import { isImeComposing } from '../../utils/ime';
import { decimalsOf, formatNumber, isNumericDraft, normalizeNumber, parseNumber } from './model';
import styles from './styles.module.scss';

export type NumberInputSize = 'sm' | 'md' | 'lg';

export interface NumberInputProps {
  /** 当前值；null / '' 表示空 */
  value: number | null | '';
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 小数位数，默认取 step 的小数位数 */
  precision?: number;
  /** 单位后缀，例如「秒」「元」 */
  suffix?: React.ReactNode;
  /** 允许清空：清空后提交时调用 onClear（否则恢复为当前值） */
  allowEmpty?: boolean;
  onClear?: () => void;
  /** 失焦 / Enter / 步进后调用，参数为提交后的值（清空为 null） */
  onCommit?: (value: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  size?: NumberInputSize;
  /** 撑满父容器宽度 */
  block?: boolean;
  /** 只用于布局（宽度、外边距等） */
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onChange,
      min,
      max,
      step = 1,
      precision,
      suffix,
      allowEmpty = false,
      onClear,
      onCommit,
      disabled = false,
      placeholder,
      size = 'md',
      block = false,
      className,
      id,
      name,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'data-testid': testId,
      onBlur,
    },
    forwardedRef
  ) => {
    const fallbackId = useId();
    const inputId = id ?? fallbackId;
    const resolvedPrecision = precision ?? decimalsOf(step);
    const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null;
    const [draft, setDraft] = useState(() => formatNumber(numericValue, resolvedPrecision));
    const editingRef = useRef(false);
    // 开始编辑时的值：Esc 放弃输入时恢复（输入过程中范围内的值会实时 onChange）
    const startValueRef = useRef<number | null>(numericValue);

    // 未在编辑时跟随外部值
    useEffect(() => {
      if (!editingRef.current) setDraft(formatNumber(numericValue, resolvedPrecision));
    }, [numericValue, resolvedPrecision]);

    const allowNegative = typeof min !== 'number' || min < 0;
    const allowDecimal = resolvedPrecision > 0;
    const normalize = (next: number) =>
      normalizeNumber(next, { min, max, precision: resolvedPrecision });

    const emit = (next: number) => {
      if (next !== numericValue) onChange(next);
    };

    const commit = () => {
      const parsed = parseNumber(draft);
      if (parsed === null) {
        if (allowEmpty) {
          setDraft('');
          if (numericValue !== null) onClear?.();
          onCommit?.(null);
        } else {
          setDraft(formatNumber(numericValue, resolvedPrecision));
          onCommit?.(numericValue);
        }
        return;
      }
      const next = normalize(parsed);
      setDraft(formatNumber(next, resolvedPrecision));
      emit(next);
      onCommit?.(next);
    };

    const stepBy = (direction: 1 | -1, multiplier = 1) => {
      if (disabled) return;
      const base = parseNumber(draft) ?? numericValue ?? (typeof min === 'number' ? min : 0);
      const next = normalize(base + direction * step * multiplier);
      setDraft(formatNumber(next, resolvedPrecision));
      emit(next);
      onCommit?.(next);
    };

    const jumpTo = (target: number | undefined) => {
      if (typeof target !== 'number') return;
      setDraft(formatNumber(target, resolvedPrecision));
      emit(target);
      onCommit?.(target);
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      // 全角数字 / 句号 / 减号统一为半角，其余非数字输入直接拒绝
      const text = event.target.value
        .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[。．]/g, '.')
        .replace(/[－—]/g, '-')
        .replace(/\s+/g, '');
      if (!isNumericDraft(text, allowNegative, allowDecimal)) return;
      editingRef.current = true;
      setDraft(text);
      const parsed = parseNumber(text);
      if (parsed === null) return;
      const rounded = normalizeNumber(parsed, { precision: resolvedPrecision });
      const inRange =
        (typeof min !== 'number' || rounded >= min) && (typeof max !== 'number' || rounded <= max);
      if (inRange) emit(rounded);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (isImeComposing(event)) return;
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          stepBy(1, event.shiftKey ? 10 : 1);
          return;
        case 'ArrowDown':
          event.preventDefault();
          stepBy(-1, event.shiftKey ? 10 : 1);
          return;
        case 'PageUp':
          event.preventDefault();
          stepBy(1, 10);
          return;
        case 'PageDown':
          event.preventDefault();
          stepBy(-1, 10);
          return;
        case 'Home':
          if (typeof min === 'number') {
            event.preventDefault();
            jumpTo(min);
          }
          return;
        case 'End':
          if (typeof max === 'number') {
            event.preventDefault();
            jumpTo(max);
          }
          return;
        case 'Enter':
          event.preventDefault();
          commit();
          return;
        case 'Escape':
          // 只有改动过才消费 Esc（放弃输入），否则留给外层弹窗关闭
          if (
            editingRef.current &&
            (draft !== formatNumber(startValueRef.current, resolvedPrecision) ||
              numericValue !== startValueRef.current)
          ) {
            event.preventDefault();
            event.stopPropagation();
            const start = startValueRef.current;
            setDraft(formatNumber(start, resolvedPrecision));
            if (start !== null && start !== numericValue) onChange(start);
            editingRef.current = false;
          }
          return;
        default:
      }
    };

    const current = parseNumber(draft) ?? numericValue;
    const atMin = typeof min === 'number' && current !== null && current <= min;
    const atMax = typeof max === 'number' && current !== null && current >= max;

    return (
      <div
        className={[
          styles.field,
          styles[size],
          block ? styles.block : '',
          disabled ? styles.disabled : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid={testId}
      >
        <input
          ref={forwardedRef}
          id={inputId}
          name={name}
          className={styles.input}
          type="text"
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          role="spinbutton"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-valuenow={numericValue ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          placeholder={placeholder}
          disabled={disabled}
          value={draft}
          onFocus={() => {
            editingRef.current = true;
            startValueRef.current = numericValue;
          }}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            commit();
            editingRef.current = false;
            onBlur?.(event);
          }}
        />
        {suffix !== undefined && suffix !== null && (
          <span className={styles.suffix} aria-hidden="true">
            {suffix}
          </span>
        )}
        <span className={styles.steppers}>
          <button
            type="button"
            tabIndex={-1}
            className={styles.stepper}
            aria-label={ariaLabel ? `减少${ariaLabel}` : '减少'}
            aria-controls={inputId}
            disabled={disabled || atMin}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => stepBy(-1)}
          >
            <VscRemove aria-hidden="true" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            className={styles.stepper}
            aria-label={ariaLabel ? `增加${ariaLabel}` : '增加'}
            aria-controls={inputId}
            disabled={disabled || atMax}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => stepBy(1)}
          >
            <VscAdd aria-hidden="true" />
          </button>
        </span>
      </div>
    );
  }
);

NumberInput.displayName = 'NumberInput';

export default NumberInput;
