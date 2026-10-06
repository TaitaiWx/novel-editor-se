import React from 'react';
import styles from './styles.module.scss';

interface SectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  count?: number;
  active?: boolean;
  /** 为 true 时仅响应单击（忽略双击的第二次 click），与原有交互保持一致 */
  singleClickOnly?: boolean;
  /** 行尾的附加操作按钮（例如「新建」） */
  actions?: React.ReactNode;
  /** 分区是否展开（提供时输出 aria-expanded，便于辅助技术与测试识别折叠状态） */
  expanded?: boolean;
  /** 悬停说明（分区用途） */
  tooltip?: string;
  onToggle: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/** 文件面板中各对象分区（正文 / 角色 / 设定 / 成长档案 / 资料）的标题行 */
const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  icon,
  count,
  active = false,
  singleClickOnly = false,
  actions,
  expanded,
  tooltip,
  onToggle,
  onContextMenu,
}) => (
  <div
    className={styles.objectSectionRow}
    style={{ paddingLeft: '14px' }}
    onContextMenu={onContextMenu}
  >
    <button
      type="button"
      className={`${styles.storyNodeButton} ${styles.storyNodeButtonGroup}${
        active ? ` ${styles.storyNodeButtonActive}` : ''
      }`}
      aria-expanded={expanded}
      title={tooltip}
      onClick={(event) => {
        if (singleClickOnly && event.detail !== 1) return;
        onToggle();
      }}
    >
      {icon !== undefined && <span className={styles.storyNodeIcon}>{icon}</span>}
      <span className={styles.storyNodeTitle}>{title}</span>
      {count !== undefined && <span className={styles.supportNodeCount}>{count}</span>}
    </button>
    {actions !== undefined && <span className={styles.sectionActions}>{actions}</span>}
  </div>
);

export default SectionHeader;
