/** 文件树里的行内新建输入框（新建文件 / 目录时出现在树中），从 index.tsx 拆出 */
import React, { useEffect, useRef, useState } from 'react';
import { isImeComposing } from '../../utils/ime';
import { getFileIcon } from './fileIcons';
import styles from './styles.module.scss';

const InlineCreateInput: React.FC<{
  type: 'file' | 'directory';
  onSubmit: (name: string) => void;
  onCancel: () => void;
  level?: number;
  baseIndent?: number;
  showExpandIcon?: boolean;
}> = ({ type, onSubmit, onCancel, level = 0, baseIndent = 8, showExpandIcon = true }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (isImeComposing(e)) return;
    if (e.key === 'Enter' && value.trim()) {
      submittedRef.current = true;
      onSubmit(value.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  const handleBlur = () => {
    if (!submittedRef.current) {
      onCancel();
    }
  };

  const iconName = type === 'directory' ? 'folder' : value || 'file.txt';
  const iconType = type === 'directory' ? 'directory' : 'file';
  const { icon, className } = getFileIcon(iconName, iconType);

  return (
    <div className={styles.fileTreeItem}>
      <div className={styles.itemHeader} style={{ paddingLeft: `${baseIndent + level * 16}px` }}>
        {showExpandIcon ? (
          <span className={`${styles.expandIcon} ${styles.hidden}`}>&#9654;</span>
        ) : null}
        <span className={`${styles.fileIcon} ${styles[className]}`}>{icon}</span>
        <input
          ref={inputRef}
          className={styles.inlineInput}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={type === 'file' ? '文件名' : '目录名'}
        />
      </div>
    </div>
  );
};

export default InlineCreateInput;
