import React, { useRef, useState } from 'react';
import {
  AiOutlineDoubleLeft,
  AiOutlineFolderOpen,
  AiOutlinePlus,
  AiOutlineReload,
  AiOutlineSearch,
} from 'react-icons/ai';
import Popover from '../../Popover';
import Tooltip from '../../Tooltip';
import InlineRenameInput, { isRenameShortcut } from '../../InlineRenameInput';
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
  /** 双击项目名（或聚焦后按 F2 / Enter）行内重命名，提交新名称；未提供时项目名不可编辑 */
  onRenameProject?: (nextName: string) => void;
  /** 项目名右侧的附加内容（「项目说明」按钮） */
  identityExtra?: React.ReactNode;
  onOpenFolder: () => void;
  onToggleSearch: () => void;
  onCollapse?: () => void;
  onRefresh: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/** 文件面板顶部：项目名（双击重命名）+ 项目说明 | 打开/搜索/新建/刷新 | 折叠侧边栏（最右侧） */
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
  identityExtra,
  onOpenFolder,
  onToggleSearch,
  onCollapse,
  onRefresh,
  onContextMenu,
}) => {
  const createMenuButtonRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [renaming, setRenaming] = useState(false);
  const canRename = Boolean(onRenameProject) && !isWorkspaceBusy && Boolean(workspaceLabel);
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
        {renaming && onRenameProject ? (
          <InlineRenameInput
            className={styles.projectNameInput}
            initialValue={workspaceLabel ?? ''}
            ariaLabel="重命名项目"
            restoreFocusRef={nameRef}
            onCommit={(nextName) => {
              setRenaming(false);
              onRenameProject(nextName);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : canRename ? (
          <span className={styles.nameSlot}>
            <Tooltip content="双击重命名" position="bottom">
              <span
                ref={nameRef}
                className={`${styles.workspaceName} ${styles.editableName}`}
                tabIndex={0}
                aria-label={`项目名 ${workspaceLabel}，双击或按 F2 重命名`}
                aria-keyshortcuts="F2"
                onDoubleClick={(event) => {
                  event.preventDefault();
                  setRenaming(true);
                }}
                onKeyDown={(event) => {
                  if (isRenameShortcut(event) || event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    setRenaming(true);
                  }
                }}
              >
                {workspaceLabel}
              </span>
            </Tooltip>
          </span>
        ) : (
          <span className={styles.workspaceName}>{workspaceLabel}</span>
        )}
        {!renaming && identityExtra}
        {isWorkspaceBusy && (
          <span className={styles.workspaceStatus} aria-live="polite">
            正在切换作品…
          </span>
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
        {onCollapse && (
          <>
            <span className={styles.workspaceActionDivider} aria-hidden="true" />
            {renderIconButton('折叠侧边栏', onCollapse, <AiOutlineDoubleLeft />)}
          </>
        )}
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
