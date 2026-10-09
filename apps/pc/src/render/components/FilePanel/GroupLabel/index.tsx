import React, { useState } from 'react';
import InlineRenameInput from '../../InlineRenameInput';
import Tooltip from '../../Tooltip';
import styles from './styles.module.scss';

interface GroupLabelProps {
  label: string;
  count: number;
  /** 提供时：双击分组名就地重命名（这一组的条目都改成新名字） */
  onRename?: (nextName: string) => void;
}

/** 「角色」「设定」分区里的分组标题（分组名 + 数量），分组名可以双击重命名 */
const GroupLabel: React.FC<GroupLabelProps> = ({ label, count, onRename }) => {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className={styles.label}>
      {renaming && onRename ? (
        <InlineRenameInput
          initialValue={label}
          ariaLabel={`重命名分组 ${label}`}
          className={styles.input}
          onCommit={(next) => {
            setRenaming(false);
            onRename(next);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : onRename ? (
        <Tooltip content="双击重命名分组" position="top">
          <span className={styles.name} onDoubleClick={() => setRenaming(true)}>
            {label}
          </span>
        </Tooltip>
      ) : (
        <span className={styles.name}>{label}</span>
      )}
      <span className={styles.count}>{count}</span>
    </div>
  );
};

export default GroupLabel;
