import React, { useRef } from 'react';
import {
  AiOutlineEdit,
  AiOutlineFolderOpen,
  AiOutlinePlus,
  AiOutlineReload,
  AiOutlineSearch,
} from 'react-icons/ai';
import Popover from '../../Popover';
import Tooltip from '../../Tooltip';
import { formatShortcutLabel } from '../../../utils/appSettings';
import styles from './styles.module.scss';

export interface CreateMenuItem {
  label: string;
  action: (() => void) | undefined;
  disabled: boolean;
}

/** "新建"菜单项，label 为 divider 时渲染分隔线 */
export function buildCreateMenuItems(handlers: {
  onCreateVolume: () => void;
  onCreateChapter: () => void;
  onCreateDraftFolder: () => void;
  onCreateDraft: () => void;
  onCreateCharacter: () => void;
  onCreateLoreEntry: () => void;
  onCreateMaterialDirectory: () => void;
  onImportFile?: () => void;
}): CreateMenuItem[] {
  return [
    { label: '新建卷', action: handlers.onCreateVolume, disabled: false },
    { label: '新建章', action: handlers.onCreateChapter, disabled: false },
    { label: '新建稿夹', action: handlers.onCreateDraftFolder, disabled: false },
    { label: '新建稿', action: handlers.onCreateDraft, disabled: false },
    { label: 'divider', action: undefined, disabled: false },
    { label: '新建人物', action: handlers.onCreateCharacter, disabled: false },
    { label: '新建设定', action: handlers.onCreateLoreEntry, disabled: false },
    { label: 'divider', action: undefined, disabled: false },
    { label: '新建资料目录', action: handlers.onCreateMaterialDirectory, disabled: false },
    {
      label: '导入 Word / Excel 文稿',
      action: handlers.onImportFile,
      disabled: !handlers.onImportFile,
    },
  ];
}

interface WorkspaceHeaderProps {
  workspaceLabel: string | null | undefined;
  isWorkspaceBusy: boolean;
  isLoading: boolean;
  hasFolder: boolean;
  showSearch: boolean;
  quickOpenShortcut: string;
  createMenuItems: CreateMenuItem[];
  /** 新建菜单开关状态由 FilePanel 持有，保证面板内容切换时状态不丢失 */
  createMenuOpen: boolean;
  onCreateMenuOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  onRenameProject?: () => void;
  onOpenFolder: () => void;
  onToggleSearch: () => void;
  onCollapse?: () => void;
  onRefresh: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/** 文件面板顶部：作品名 + 打开/搜索/折叠/新建/刷新操作 */
const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  workspaceLabel,
  isWorkspaceBusy,
  isLoading,
  hasFolder,
  showSearch,
  quickOpenShortcut,
  createMenuItems,
  createMenuOpen,
  onCreateMenuOpenChange: setCreateMenuOpen,
  onRenameProject,
  onOpenFolder,
  onToggleSearch,
  onCollapse,
  onRefresh,
  onContextMenu,
}) => {
  const createMenuButtonRef = useRef<HTMLButtonElement>(null);
  const searchLabel = `搜索文件 (${formatShortcutLabel(quickOpenShortcut)})`;

  const renderIconButton = (
    tooltip: string,
    onClick: (() => void) | undefined,
    icon: React.ReactNode,
    disabled = false,
    className?: string
  ) => (
    <Tooltip content={tooltip} position="bottom">
      <button
        className={className || styles.workspaceAction}
        onClick={onClick}
        title={tooltip}
        aria-label={tooltip}
        disabled={disabled}
        type="button"
      >
        {icon}
      </button>
    </Tooltip>
  );

  return (
    <div className={styles.workspaceHeader} onContextMenu={onContextMenu}>
      <div className={styles.workspaceIdentity}>
        <span className={styles.workspaceName}>{workspaceLabel}</span>
        {isWorkspaceBusy && (
          <span className={styles.workspaceStatus} aria-live="polite">
            正在切换作品…
          </span>
        )}
        {onRenameProject && (
          <Tooltip content="修改作品名" position="bottom">
            <button
              type="button"
              className={styles.workspaceNameAction}
              onClick={onRenameProject}
              title="修改作品名"
              aria-label="修改作品名"
              disabled={isWorkspaceBusy}
            >
              <AiOutlineEdit />
            </button>
          </Tooltip>
        )}
      </div>
      <div className={styles.workspaceActions}>
        {renderIconButton(
          hasFolder ? '更换文件夹' : '打开文件夹',
          onOpenFolder,
          <AiOutlineFolderOpen />,
          isLoading
        )}
        <Tooltip content={searchLabel} position="bottom">
          <button
            className={`${styles.workspaceAction} ${showSearch ? styles.workspaceActionActive : ''}`}
            onClick={onToggleSearch}
            title={searchLabel}
            aria-label={searchLabel}
            type="button"
          >
            <AiOutlineSearch />
          </button>
        </Tooltip>
        {onCollapse && (
          <Tooltip content="折叠侧边栏" position="bottom">
            <button
              className={styles.workspaceAction}
              onClick={onCollapse}
              title="折叠侧边栏"
              aria-label="折叠侧边栏"
              type="button"
            >
              ◀
            </button>
          </Tooltip>
        )}
        <Tooltip content="新建" position="bottom">
          <button
            ref={createMenuButtonRef}
            className={`${styles.workspaceAction} ${createMenuOpen ? styles.workspaceActionActive : ''}`}
            onClick={() => setCreateMenuOpen((current) => !current)}
            title="新建"
            aria-label="新建"
            disabled={isLoading}
            type="button"
          >
            <AiOutlinePlus />
          </button>
        </Tooltip>
        {renderIconButton('重新扫描作品目录', onRefresh, <AiOutlineReload />, isLoading)}
      </div>
      <Popover
        open={createMenuOpen}
        anchorRef={createMenuButtonRef}
        placement="bottom"
        align="end"
        offset={6}
        className={styles.createMenuPopover}
        role="menu"
        onClose={() => setCreateMenuOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={styles.createMenu}>
          {createMenuItems.map((item, index) =>
            item.label === 'divider' ? (
              <div key={`divider-${index}`} className={styles.createMenuDivider} />
            ) : (
              <button
                key={item.label}
                type="button"
                className={styles.createMenuItem}
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  setCreateMenuOpen(false);
                  item.action?.();
                }}
                role="menuitem"
              >
                {item.label}
              </button>
            )
          )}
        </div>
      </Popover>
    </div>
  );
};

export default WorkspaceHeader;
