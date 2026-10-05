import React from 'react';
import { AiOutlineDelete, AiOutlineEdit } from 'react-icons/ai';
import Tooltip from '../../Tooltip';
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
  /** 未提供时不显示「修改」按钮 */
  onRename?: () => void;
  /** 未提供时不显示「删除」按钮 */
  onDelete?: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/** 角色 / 设定 / 成长档案等对象条目行：点击打开，右侧提供修改与删除操作（可选） */
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
}) => (
  <div
    className={`${styles.objectNodeShell} ${active ? styles.objectNodeShellActive : ''}`}
    style={{ marginLeft: '28px', marginRight: '12px' }}
    onContextMenu={onContextMenu}
  >
    <div
      role="button"
      tabIndex={0}
      className={styles.objectNode}
      onClick={onOpen}
      onKeyDown={(event) => handleRowActivationKey(event, onOpen)}
    >
      <span className={styles.objectNodeMarker}>{icon}</span>
      <span className={styles.objectNodePrimary}>
        <span className={styles.objectNodeTitle}>{title}</span>
        {badge && <span className={styles.objectNodeBadge}>{badge}</span>}
        {onRename && (
          <Tooltip content={`修改${kindLabel}`} position="top">
            <button
              type="button"
              className={styles.objectNodeAction}
              onClick={(event) => {
                event.stopPropagation();
                onRename();
              }}
              aria-label={`修改${kindLabel} ${title}`}
              title={`修改${kindLabel} ${title}`}
            >
              <AiOutlineEdit />
            </button>
          </Tooltip>
        )}
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

export default ObjectItemRow;
