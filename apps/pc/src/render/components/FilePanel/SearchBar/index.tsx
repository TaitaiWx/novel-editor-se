import React from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { isImeComposing } from '../../../utils/ime';
import type { SearchNavigateAction } from '../hooks/useFilePanelSearchResults';
import styles from './styles.module.scss';

interface SearchBarProps {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  /** 按下 Escape 时关闭搜索（由父组件清空关键词并隐藏） */
  onDismiss: () => void;
  /** ↑ / ↓ 移动搜索结果选中项，Enter 打开 */
  onNavigate?: (action: SearchNavigateAction) => void;
  /** 当前选中结果的 DOM id */
  activeDescendant?: string;
}

/** 文件面板顶部的作品内搜索框（名称 + 正文内容） */
const SearchBar: React.FC<SearchBarProps> = ({
  inputRef,
  value,
  onChange,
  onDismiss,
  onNavigate,
  activeDescendant,
}) => (
  <div className={styles.searchBar}>
    <AiOutlineSearch className={styles.searchIcon} />
    <input
      ref={inputRef}
      className={styles.searchInput}
      value={value}
      role="combobox"
      aria-label="搜索作品内容"
      aria-expanded={Boolean(value.trim())}
      aria-controls="file-search-results"
      aria-activedescendant={value.trim() ? activeDescendant : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        } else if (onNavigate && value.trim()) {
          const action: SearchNavigateAction | null =
            e.key === 'ArrowDown'
              ? 'next'
              : e.key === 'ArrowUp'
                ? 'prev'
                : e.key === 'Enter'
                  ? 'open'
                  : null;
          if (action) {
            e.preventDefault();
            onNavigate(action);
          }
        }
      }}
      placeholder="搜索作品内容..."
    />
    {value && (
      <button
        className={styles.searchClear}
        aria-label="清空搜索"
        onClick={() => {
          onChange('');
          inputRef.current?.focus();
        }}
      >
        ×
      </button>
    )}
  </div>
);

export default SearchBar;
