import UiButton from '@novel-editor/ui/Button';
import React, { useRef, useState } from 'react';
import Popover from '@novel-editor/ui/Popover';
import styles from './styles.module.scss';

export interface GrowthMoreMenuProps {
  characterName: string;
  busy: boolean;
  onSync: () => void;
  onEditRules: () => void;
  onOpenFolder: () => void;
  onOpenHelp: () => void;
  onDelete: () => void;
}

/** 成长卡标题区的「⋯」菜单：低频操作集中在这里 */
export const GrowthMoreMenu: React.FC<GrowthMoreMenuProps> = ({
  characterName,
  busy,
  onSync,
  onEditRules,
  onOpenFolder,
  onOpenHelp,
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    setOpen(false);
    setConfirmDelete(false);
  };
  const run = (action: () => void) => () => {
    close();
    action();
  };

  return (
    <>
      <UiButton
        unstyled
        ref={anchorRef}
        type="button"
        className={styles.trigger}
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        data-growth-tour="more"
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋯
      </UiButton>
      <Popover
        open={open}
        anchorRef={anchorRef}
        align="end"
        className={styles.menu}
        role="menu"
        onClose={close}
        closeOnOutsideClick
        closeOnEscape
        zIndex={2000}
      >
        <UiButton
          unstyled
          type="button"
          role="menuitem"
          className={styles.item}
          disabled={busy}
          onClick={run(onSync)}
        >
          同步人物卡 / 设定到记忆文件夹
        </UiButton>
        <UiButton
          unstyled
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={run(onEditRules)}
        >
          编辑规则
        </UiButton>
        <UiButton
          unstyled
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={run(onOpenFolder)}
        >
          打开数据文件夹
        </UiButton>
        <UiButton
          unstyled
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={run(onOpenHelp)}
        >
          使用说明
        </UiButton>
        <div className={styles.separator} role="separator" />
        {confirmDelete ? (
          <UiButton
            unstyled
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.danger} ${styles.confirm}`}
            disabled={busy}
            onClick={run(onDelete)}
          >
            确认删除「{characterName}」的成长卡？
            <span className={styles.sub}>会删除 资料/记忆/角色/ 下的文件，无法撤销</span>
          </UiButton>
        ) : (
          <UiButton
            unstyled
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.danger}`}
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            删除成长卡…
          </UiButton>
        )}
      </Popover>
    </>
  );
};

export default GrowthMoreMenu;
