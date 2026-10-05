import React from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { isImeComposing } from '../../../utils/ime';
import styles from './styles.module.scss';

interface SearchBarProps {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  /** 按下 Escape 时关闭搜索（由父组件清空关键词并隐藏） */
  onDismiss: () => void;
}

/** 文件面板顶部的作品内搜索框 */
const SearchBar: React.FC<SearchBarProps> = ({ inputRef, value, onChange, onDismiss }) => (
  <div className={styles.searchBar}>
    <AiOutlineSearch className={styles.searchIcon} />
    <input
      ref={inputRef}
      className={styles.searchInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === 'Escape') {
          onDismiss();
        }
      }}
      placeholder="搜索作品内容..."
    />
    {value && (
      <button className={styles.searchClear} onClick={() => onChange('')}>
        ×
      </button>
    )}
  </div>
);

export default SearchBar;
