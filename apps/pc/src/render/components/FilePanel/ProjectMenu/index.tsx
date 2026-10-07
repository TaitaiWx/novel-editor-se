/**
 * 文件面板顶部「新建」右侧的「⋯ 更多」菜单（项目级操作）
 *
 * 菜单：在访达中显示、重命名项目｜打开其他文件夹…、打开最近使用 ▸、刷新
 * 项目名本身不再是下拉触发器（双击 / F2 重命名，见 WorkspaceHeader）；项目说明是文件面板里的独立分区。
 *
 * 键盘：触发器 Enter / Space / ↓ 打开并聚焦第一项，↑ 聚焦最后一项；菜单内 ↑ / ↓ / Home / End 移动，
 * → 展开「打开最近使用」、← 收起，Esc 关闭并把焦点还给触发器，Tab 关闭。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AiOutlineEdit,
  AiOutlineEllipsis,
  AiOutlineFolder,
  AiOutlineFolderOpen,
  AiOutlineHistory,
  AiOutlineReload,
  AiOutlineRight,
} from 'react-icons/ai';
import Popover from '../../Popover';
import Tooltip from '../../Tooltip';
import { formatShortcutLabel } from '../../../utils/appSettings';
import styles from './styles.module.scss';

export const PROJECT_MORE_LABEL = '更多操作';

/** 「在访达中显示」随平台变化 */
export function getRevealInFileManagerLabel(platform: string): string {
  if (/mac|darwin/i.test(platform)) return '在访达中显示';
  if (/win/i.test(platform)) return '在资源管理器中显示';
  return '在文件管理器中显示';
}

function currentPlatform(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.platform || navigator.userAgent;
}

/** 最近使用的文件夹：去掉当前文件夹，最多 8 个 */
export function pickRecentFolders(folders: string[], current: string | null, max = 8): string[] {
  return folders.filter((folder) => folder && folder !== current).slice(0, max);
}

export function folderBaseName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

async function defaultLoadRecentFolders(): Promise<string[]> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return [];
  try {
    const folders = await ipc.invoke('get-recent-folders');
    return Array.isArray(folders) ? folders : [];
  } catch {
    return [];
  }
}

function defaultReveal(folderPath: string): void {
  void window.electron?.ipcRenderer
    .invoke('show-item-in-folder', folderPath)
    .catch(() => undefined);
}

export interface ProjectMenuProps {
  folderPath: string;
  /** 切换作品 / 加载中：只禁用重命名 */
  busy?: boolean;
  canRename: boolean;
  onStartRename: () => void;
  onOpenFolder: () => void;
  onOpenRecentFolder?: (folderPath: string) => void;
  onRefresh: () => void;
  /** 测试注入；默认经 show-item-in-folder IPC */
  onReveal?: (folderPath: string) => void;
  /** 测试注入；默认经 get-recent-folders IPC */
  loadRecentFolders?: () => Promise<string[]>;
  platform?: string;
}

type FocusTarget = 'first' | 'last' | null;

const ProjectMenu: React.FC<ProjectMenuProps> = ({
  folderPath,
  busy = false,
  canRename,
  onStartRename,
  onOpenFolder,
  onOpenRecentFolder,
  onRefresh,
  onReveal = defaultReveal,
  loadRecentFolders = defaultLoadRecentFolders,
  platform = currentPlatform(),
}) => {
  const [open, setOpen] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[] | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpenRef = useRef<FocusTarget>(null);
  const recentToggleRef = useRef<HTMLButtonElement>(null);
  const focusRecentRef = useRef(false);

  const items = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
          []
      ),
    []
  );

  const openMenu = useCallback((focus: FocusTarget) => {
    focusOnOpenRef.current = focus;
    setRecentExpanded(false);
    setOpen(true);
  }, []);

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      setRecentExpanded(false);
      focusRecentRef.current = false;
      if (restoreFocus) triggerRef.current?.focus();
    },
    [triggerRef]
  );

  // 打开时读取最近使用（每次打开刷新，菜单栏里清除后这里同步）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadRecentFolders().then((folders) => {
      if (!cancelled) setRecentFolders(folders);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loadRecentFolders]);

  useEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    const list = items();
    const target = focusOnOpenRef.current === 'last' ? list[list.length - 1] : list[0];
    focusOnOpenRef.current = null;
    target?.focus();
  }, [open, items]);

  // 最近使用还在读取时先保留标记，读取完成后再聚焦
  const focusFirstRecent = useCallback(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      '[data-recent-item]:not([disabled])'
    );
    if (!first) return;
    focusRecentRef.current = false;
    first.focus();
  }, []);

  useEffect(() => {
    if (recentExpanded && focusRecentRef.current) focusFirstRecent();
  }, [recentExpanded, recentFolders, focusFirstRecent]);

  const recent = pickRecentFolders(recentFolders ?? [], folderPath);

  const run = (action: () => void) => {
    closeMenu(false);
    action();
  };

  const moveFocus = (delta: number | 'first' | 'last') => {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (delta === 'first') next = 0;
    else if (delta === 'last') next = list.length - 1;
    else next = (index + delta + list.length) % list.length;
    list[next]?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus('first');
        break;
      case 'End':
        event.preventDefault();
        moveFocus('last');
        break;
      case 'ArrowRight':
        if (target === recentToggleRef.current) {
          event.preventDefault();
          // 展开后（列表渲染完）聚焦第一个最近使用的文件夹
          focusRecentRef.current = true;
          setRecentExpanded(true);
          if (recentExpanded) focusFirstRecent();
        }
        break;
      case 'ArrowLeft':
        if (target.hasAttribute('data-recent-item') || target === recentToggleRef.current) {
          event.preventDefault();
          setRecentExpanded(false);
          recentToggleRef.current?.focus();
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        break;
      case 'Tab':
        closeMenu(false);
        break;
      default:
        break;
    }
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      // 阻止原生 click，避免按键与 click 各切换一次
      event.preventDefault();
      event.stopPropagation();
      if (open) closeMenu(true);
      else openMenu('first');
    }
  };

  const revealLabel = getRevealInFileManagerLabel(platform);

  return (
    <>
      <Tooltip content={PROJECT_MORE_LABEL} position="bottom">
        <button
          ref={triggerRef}
          type="button"
          className={`${styles.trigger} ${open ? styles.triggerActive : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={PROJECT_MORE_LABEL}
          data-testid="project-menu-trigger"
          onClick={() => {
            if (open) closeMenu(false);
            else openMenu(null);
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <AiOutlineEllipsis aria-hidden="true" />
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={triggerRef}
        placement="bottom"
        align="end"
        offset={6}
        className={styles.popover}
        role="presentation"
        onClose={() => closeMenu(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label="项目菜单"
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.item}
            onClick={() => run(() => onReveal(folderPath))}
          >
            <AiOutlineFolder className={styles.itemIcon} />
            <span className={styles.itemLabel}>{revealLabel}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.item}
            disabled={!canRename || busy}
            aria-keyshortcuts="F2"
            onClick={() => run(onStartRename)}
          >
            <AiOutlineEdit className={styles.itemIcon} />
            <span className={styles.itemLabel}>重命名项目</span>
            <kbd className={styles.itemShortcut} aria-hidden="true">
              F2
            </kbd>
          </button>

          <div className={styles.separator} role="separator" />

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.item}
            aria-keyshortcuts="Meta+O Control+O"
            onClick={() => run(onOpenFolder)}
          >
            <AiOutlineFolderOpen className={styles.itemIcon} />
            <span className={styles.itemLabel}>打开其他文件夹…</span>
            <kbd className={styles.itemShortcut} aria-hidden="true">
              {formatShortcutLabel('Mod+O')}
            </kbd>
          </button>
          {onOpenRecentFolder && (
            <>
              <button
                ref={recentToggleRef}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-haspopup="true"
                aria-expanded={recentExpanded}
                className={styles.item}
                onClick={() => setRecentExpanded((value) => !value)}
              >
                <AiOutlineHistory className={styles.itemIcon} />
                <span className={styles.itemLabel}>打开最近使用</span>
                <AiOutlineRight
                  className={`${styles.itemChevron} ${recentExpanded ? styles.itemChevronOpen : ''}`}
                  aria-hidden="true"
                />
              </button>
              {recentExpanded && (
                <div role="group" aria-label="最近使用" className={styles.recentList}>
                  {recent.length === 0 ? (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className={`${styles.item} ${styles.subItem}`}
                      data-recent-item=""
                      disabled
                    >
                      <span className={styles.itemLabel}>
                        {recentFolders === null ? '正在读取…' : '无最近使用的文件夹'}
                      </span>
                    </button>
                  ) : (
                    recent.map((folder) => (
                      <button
                        key={folder}
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className={`${styles.item} ${styles.subItem}`}
                        data-recent-item=""
                        title={folder}
                        onClick={() => run(() => onOpenRecentFolder(folder))}
                      >
                        <span className={styles.itemLabel}>{folderBaseName(folder)}</span>
                        <span className={styles.itemPath}>{folder}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.item}
            onClick={() => run(onRefresh)}
          >
            <AiOutlineReload className={styles.itemIcon} />
            <span className={styles.itemLabel}>刷新</span>
          </button>
        </div>
      </Popover>
    </>
  );
};

export default ProjectMenu;
