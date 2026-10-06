import React, { useRef, useState } from 'react';
import { AiOutlineDelete } from 'react-icons/ai';
import Tooltip from '../../Tooltip';
import InlineRenameInput, { isRenameShortcut } from '../../InlineRenameInput';
import { handleRowActivationKey } from '../utils';
import styles from './styles.module.scss';

interface ObjectItemRowProps {
  /** 对象类型名称，用于按钮提示，例如"人物"、"设定" */
  kindLabel: string;
  title: string;
  meta: string;
  icon: React.ReactNode;
  active: boolean;
  /** 标题后的小徽章，例如成长档案的等级「Lv.3」 */
  badge?: string;
  onOpen: () => void;
  /** 行内重命名提交（双击名称 / F2）；未提供时不可重命名 */
  onRename?: (nextName: string) => void;
  /** 未提供时不显示「删除」按钮 */
  onDelete?: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/** 角色 / 设定 / 成长档案等对象条目行：点击打开，双击名称或 F2 行内重命名，右侧可选删除操作 */
const ObjectItemRow: React.FC<ObjectItemRowProps> = ({
  kindLabel,
  title,
  meta,
  icon,
  active,
  badge,
  onOpen,
  onRename,
  onDelete,
  onContextMenu,
}) => {
  const [renaming, setRenaming] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const startRename = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setRenaming(true);
  };

  return (
    <div
      className={`${styles.objectNodeShell} ${active ? styles.objectNodeShellActive : ''}`}
      style={{ marginLeft: '28px', marginRight: '12px' }}
      onContextMenu={onContextMenu}
    >
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        aria-keyshortcuts={onRename ? 'F2' : undefined}
        className={styles.objectNode}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (onRename && isRenameShortcut(event)) {
            startRename(event);
            return;
          }
          handleRowActivationKey(event, onOpen);
        }}
      >
        <span className={styles.objectNodeMarker}>{icon}</span>
        <span className={styles.objectNodePrimary}>
          {renaming && onRename ? (
            <InlineRenameInput
              initialValue={title}
              ariaLabel={`重命名${kindLabel} ${title}`}
              restoreFocusRef={rowRef}
              onCommit={(nextName) => {
                setRenaming(false);
                onRename(nextName);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <span
              className={styles.objectNodeTitle}
              onDoubleClick={onRename ? startRename : undefined}
            >
              {title}
            </span>
          )}
          {badge && <span className={styles.objectNodeBadge}>{badge}</span>}
        </span>
        <span className={styles.objectNodeMetaInline}>{meta}</span>
      </div>
      {onDelete && (
        <Tooltip content={`删除${kindLabel}`} position="top">
          <button
            type="button"
            className={styles.objectNodeAction}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label={`删除${kindLabel} ${title}`}
            title={`删除${kindLabel} ${title}`}
          >
            <AiOutlineDelete />
          </button>
        </Tooltip>
      )}
    </div>
  );
};

export default ObjectItemRow;
