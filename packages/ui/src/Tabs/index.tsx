import UiButton from '../Button';
import React, { useRef } from 'react';
import { isImeComposing } from '../utils/ime';
import styles from './styles.module.scss';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  badge?: React.ReactNode;
  status?: React.ReactNode;
  /** 对称预留状态空间，状态变化时文字保持居中且宽度不跳动。 */
  reserveStatusSpace?: boolean;
  disabled?: boolean;
  error?: boolean;
  title?: string;
  panelId?: string;
}

export interface TabsProps<T extends string = string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** 页内分段 Tab：统一居中、徽标、状态与键盘导航；窄容器横向滚动。 */
export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: TabsProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const focusableId = enabled.some((item) => item.id === value) ? value : enabled[0]?.id;
  return (
    <div
      className={[styles.tabs, className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={label}
    >
      {items.map((item) => (
        <UiButton
          unstyled
          key={item.id}
          type="button"
          role="tab"
          ref={(node) => {
            if (node) buttons.current.set(item.id, node);
            else buttons.current.delete(item.id);
          }}
          className={styles.tab}
          aria-selected={value === item.id}
          aria-controls={item.panelId}
          tabIndex={focusableId === item.id ? 0 : -1}
          disabled={item.disabled}
          title={item.title}
          data-failed={item.error || undefined}
          data-status-space={item.reserveStatusSpace || !!item.status || undefined}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            const current = enabled.findIndex((candidate) => candidate.id === item.id);
            let next: number;
            if (event.key === 'ArrowRight') next = (current + 1) % enabled.length;
            else if (event.key === 'ArrowLeft')
              next = (current - 1 + enabled.length) % enabled.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = enabled.length - 1;
            else return;
            event.preventDefault();
            const target = enabled[next];
            if (!target) return;
            buttons.current.get(target.id)?.focus();
            onChange(target.id);
          }}
        >
          <span className={styles.content}>
            <span>{item.label}</span>
            {item.badge !== undefined && item.badge !== null && (
              <span className={styles.badge}>{item.badge}</span>
            )}
          </span>
          {item.status && <span className={styles.status}>{item.status}</span>}
        </UiButton>
      ))}
    </div>
  );
}
