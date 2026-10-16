import UiButton from '../Button';
import UiInput from '../Input';
import React, { useEffect, useId, useRef, useState } from 'react';
import { VscCheck, VscClose } from 'react-icons/vsc';
import Popover from '../Popover';
import { isImeComposing } from '../utils/ime';
import styles from './styles.module.scss';

export interface SearchMultiSelectOption {
  value: string;
  label: string;
}

/** 搜索已有选项并多选；输入文字只用于筛选，不创建虚构的关联目标。 */
export default function SearchMultiSelect({
  value,
  options,
  onChange,
  label,
  disabled = false,
  placeholder = '输入搜索并选择',
  emptyText = '没有匹配的选项',
}: {
  value: readonly string[];
  options: readonly SearchMultiSelectOption[];
  onChange: (value: string[]) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const index = Math.min(active, filtered.length - 1);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open && index >= 0)
      document.getElementById(`${id}-${index}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, index, id]);
  const toggle = (target: string) => {
    if (disabled) return;
    onChange(value.includes(target) ? value.filter((item) => item !== target) : [...value, target]);
    input.current?.focus();
  };
  return (
    <>
      <div ref={anchor} className={styles.control} data-disabled={disabled || undefined}>
        {value.map((selected) => (
          <span key={selected} className={styles.chip}>
            <span>{options.find((option) => option.value === selected)?.label ?? selected}</span>
            <UiButton
              unstyled
              type="button"
              disabled={disabled}
              aria-label={`移除${options.find((option) => option.value === selected)?.label ?? selected}`}
              onClick={() => toggle(selected)}
            >
              <VscClose />
            </UiButton>
          </span>
        ))}
        <UiInput
          unstyled
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && index >= 0 ? `${id}-${index}` : undefined}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive(
                open
                  ? Math.max(
                      0,
                      Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))
                    )
                  : 0
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              if (open && filtered[index]) toggle(filtered[index].value);
              else setOpen(true);
            } else if (event.key === 'Tab') setOpen(false);
          }}
        />
      </div>
      <Popover
        open={open && !disabled}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        closeOnOutsideClick
        role="presentation"
        className={styles.popup}
      >
        <div
          id={id}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className={styles.options}
          onMouseDown={(event) => event.preventDefault()}
        >
          {filtered.map((option, optionIndex) => (
            <div
              key={option.value}
              id={`${id}-${optionIndex}`}
              role="option"
              aria-selected={value.includes(option.value)}
              data-active={optionIndex === index || undefined}
              className={styles.option}
              onMouseEnter={() => setActive(optionIndex)}
              onClick={() => toggle(option.value)}
            >
              <span className={styles.check}>{value.includes(option.value) && <VscCheck />}</span>
              {option.label}
            </div>
          ))}
          {!filtered.length && <div className={styles.empty}>{emptyText}</div>}
        </div>
      </Popover>
    </>
  );
}
