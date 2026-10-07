/**
 * 自绘下拉选择框：替代原生 <select>，外观与应用暗色主题统一。
 *
 * - 触发器是 role="combobox" 的按钮，焦点始终留在触发器上（aria-activedescendant 指向当前项）
 * - 弹出的 listbox 经 OverlayPortal 渲染到 body，位于触发器下方，空间不够时翻到上方并限制在视口内
 * - 键盘：Enter / Space / ↓ / ↑ 打开；↑ / ↓ / Home / End 移动；Enter / Space 选中；Esc / Tab 关闭；
 *   输入字符按首字跳转（关闭时直接选中，与原生 select 一致）
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VscCheck, VscChevronDown } from 'react-icons/vsc';
import OverlayPortal from '../OverlayPortal';
import { isImeComposing } from '../../utils/ime';
import {
  findTypeaheadIndex,
  flattenSelectItems,
  isSelectGroup,
  nextEnabledIndex,
  type SelectItem,
  type SelectOption,
} from './model';
import styles from './styles.module.scss';

export type { SelectGroup, SelectItem, SelectOption } from './model';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectProps<T extends string = string> {
  /** 当前值；'' 且没有对应选项时显示 placeholder */
  value: T | '';
  options: readonly SelectItem<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: SelectSize;
  /** 撑满父容器宽度 */
  block?: boolean;
  /** 只用于布局（宽度、外边距等），外观由组件统一提供 */
  className?: string;
  /** 弹出列表的附加类名 */
  popupClassName?: string;
  id?: string;
  /** 设置后同时渲染一个隐藏 input，便于表单提交 */
  name?: string;
  title?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
}

interface PopupPosition {
  left: number;
  top: number;
  minWidth: number;
  maxHeight: number;
  positioned: boolean;
}

const POPUP_GAP = 4;
const VIEWPORT_PADDING = 8;
const POPUP_MAX_HEIGHT = 300;
const TYPEAHEAD_RESET_MS = 600;

const INITIAL_POSITION: PopupPosition = {
  left: 0,
  top: 0,
  minWidth: 0,
  maxHeight: POPUP_MAX_HEIGHT,
  positioned: false,
};

function SelectInner<T extends string>(
  {
    value,
    options,
    onChange,
    placeholder = '请选择',
    disabled = false,
    size = 'md',
    block = false,
    className,
    popupClassName,
    id,
    name,
    title,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'data-testid': testId,
    onBlur,
    onFocus,
  }: SelectProps<T>,
  forwardedRef: React.ForwardedRef<HTMLButtonElement>
) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<PopupPosition>(INITIAL_POSITION);

  useImperativeHandle(forwardedRef, () => triggerRef.current as HTMLButtonElement);

  const flat = useMemo(() => flattenSelectItems(options), [options]);
  const selectedIndex = flat.findIndex((option) => option.value === value);
  const selected: SelectOption<T> | null = selectedIndex >= 0 ? flat[selectedIndex] : null;
  const containRefs = useMemo(() => [triggerRef], []);
  const optionId = useCallback((index: number) => `${baseId}-option-${index}`, [baseId]);

  const openPopup = useCallback(
    (preferIndex?: number) => {
      if (disabled) return;
      const start =
        preferIndex ?? (selectedIndex >= 0 && !flat[selectedIndex].disabled ? selectedIndex : -1);
      setActiveIndex(start >= 0 ? start : nextEnabledIndex(flat, -1, 1));
      setOpen(true);
    },
    [disabled, flat, selectedIndex]
  );

  const closePopup = useCallback(() => {
    typeaheadRef.current = { text: '', at: 0 };
    setOpen(false);
    setPosition(INITIAL_POSITION);
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = flat[index];
      if (!option || option.disabled) return;
      closePopup();
      triggerRef.current?.focus();
      if (option.value !== value) onChange(option.value);
    },
    [closePopup, flat, onChange, value]
  );

  // 弹层打开后测量并定位：默认在下方，放不下且上方更宽裕时翻到上方
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const below = viewportHeight - rect.bottom - POPUP_GAP - VIEWPORT_PADDING;
    const above = rect.top - POPUP_GAP - VIEWPORT_PADDING;
    const naturalHeight = Math.min(popup.scrollHeight || POPUP_MAX_HEIGHT, POPUP_MAX_HEIGHT);
    const placeAbove = below < naturalHeight && above > below;
    const maxHeight = Math.max(80, Math.min(POPUP_MAX_HEIGHT, placeAbove ? above : below));
    const height = Math.min(naturalHeight, maxHeight);
    const top = placeAbove ? rect.top - POPUP_GAP - height : rect.bottom + POPUP_GAP;
    const width = Math.max(popup.offsetWidth, rect.width);
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(rect.left, viewportWidth - width - VIEWPORT_PADDING)
    );
    setPosition({ left, top, minWidth: rect.width, maxHeight, positioned: true });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition, flat.length]);

  useEffect(() => {
    if (!open) return;
    const handleResize = () => updatePosition();
    const handleScroll = (event: Event) => {
      // 列表自身滚动不需要重新定位
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      updatePosition();
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, updatePosition]);

  // 当前项始终滚动到可见范围
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = document.getElementById(optionId(activeIndex));
    if (node && typeof node.scrollIntoView === 'function')
      node.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, optionId]);

  // 禁用后立即收起
  useEffect(() => {
    if (disabled && open) closePopup();
  }, [closePopup, disabled, open]);

  const typeahead = (char: string): number => {
    const now = Date.now();
    const state = typeaheadRef.current;
    const text = now - state.at > TYPEAHEAD_RESET_MS ? char : state.text + char;
    typeaheadRef.current = { text, at: now };
    const from = open ? activeIndex : selectedIndex;
    return findTypeaheadIndex(flat, text, from);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || isImeComposing(event)) return;
    const { key } = event;

    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        openPopup();
        return;
      }
      if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const index = typeahead(key);
        if (index >= 0 && flat[index].value !== value) {
          event.preventDefault();
          onChange(flat[index].value);
        }
      }
      return;
    }

    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => nextEnabledIndex(flat, index, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => nextEnabledIndex(flat, index, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(flat, -1, 1));
        return;
      case 'End':
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(flat, flat.length, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        else closePopup();
        return;
      case 'Escape':
        // 只关闭下拉，不让外层弹窗 / 专注模式也收到 Esc
        event.preventDefault();
        event.stopPropagation();
        closePopup();
        return;
      case 'Tab':
        closePopup();
        return;
      default:
        if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const index = typeahead(key);
          if (index >= 0) {
            event.preventDefault();
            setActiveIndex(index);
          }
        }
    }
  };

  const triggerClassName = [
    styles.trigger,
    styles[size],
    block ? styles.block : '',
    open ? styles.open : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  let flatIndex = -1;
  const renderOption = (option: SelectOption<T>) => {
    flatIndex += 1;
    const index = flatIndex;
    const isSelected = option.value === value;
    return (
      <div
        key={`${index}-${option.value}`}
        id={optionId(index)}
        role="option"
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        data-active={index === activeIndex || undefined}
        className={[
          styles.option,
          isSelected ? styles.selected : '',
          option.disabled ? styles.disabled : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => {
          if (!option.disabled) setActiveIndex(index);
        }}
        onClick={() => commit(index)}
      >
        <span className={styles.check} aria-hidden="true">
          {isSelected ? <VscCheck /> : null}
        </span>
        <span className={styles.optionText}>
          <span className={styles.optionLabel}>{option.label}</span>
          {option.description && (
            <span className={styles.optionDescription}>{option.description}</span>
          )}
        </span>
      </div>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-disabled={disabled || undefined}
        data-testid={testId}
        data-value={value}
        title={title}
        disabled={disabled}
        className={triggerClassName}
        onClick={() => (open ? closePopup() : openPopup())}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
      >
        <span className={selected ? styles.value : styles.placeholder}>
          {selected ? selected.label : placeholder}
        </span>
        <VscChevronDown className={styles.chevron} aria-hidden="true" />
      </button>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      <OverlayPortal
        ref={popupRef}
        open={open}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-overlay-nested=""
        className={[styles.popup, position.positioned ? '' : styles.hidden, popupClassName ?? '']
          .filter(Boolean)
          .join(' ')}
        style={{
          left: position.left,
          top: position.top,
          minWidth: position.minWidth || undefined,
          maxHeight: position.maxHeight,
        }}
        onClose={closePopup}
        closeOnOutsideClick
        containRefs={containRefs}
      >
        {flat.length === 0 && <div className={styles.empty}>没有可选项</div>}
        {options.map((item, groupIndex) =>
          isSelectGroup(item) ? (
            <div key={`group-${groupIndex}`} role="group" aria-label={item.label}>
              <div className={styles.groupLabel} aria-hidden="true">
                {item.label}
              </div>
              {item.options.map(renderOption)}
            </div>
          ) : (
            renderOption(item)
          )
        )}
      </OverlayPortal>
    </>
  );
}

/** 泛型 forwardRef：保留 value 的字符串字面量类型 */
const Select = React.forwardRef(SelectInner) as <T extends string = string>(
  props: SelectProps<T> & { ref?: React.Ref<HTMLButtonElement> }
) => React.ReactElement;

export default Select;
