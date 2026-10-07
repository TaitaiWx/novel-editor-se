import React, { useRef, useState } from 'react';
import { AiOutlineEllipsis } from 'react-icons/ai';
import Popover from '../../../Popover';
import Tooltip from '../../../Tooltip';
import styles from './styles.module.scss';

interface OutlineToolbarProps {
  aiReady: boolean;
  /** 有正文、数据库就绪、没有进行中的操作 */
  canGenerate: boolean;
  busy: boolean;
  hasPersisted: boolean;
  presetOpen: boolean;
  onGenerateVariants: () => void;
  onRebuild: () => void;
  onImport: () => void;
  onTogglePreset: () => void;
  onSaveVersion: () => void;
  onClear: () => void;
}

/**
 * 章纲工具条：只有一个主按钮——开启 AI 时「生成章纲」（一次给出 3 种方案挑一个），
 * 否则「从正文整理」；导入、生成设置、保存版本、清空都收在「⋯」里
 */
const OutlineToolbar: React.FC<OutlineToolbarProps> = ({
  aiReady,
  canGenerate,
  busy,
  hasPersisted,
  presetOpen,
  onGenerateVariants,
  onRebuild,
  onImport,
  onTogglePreset,
  onSaveVersion,
  onClear,
}) => {
  const moreRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className={styles.toolbar}>
      <Tooltip
        content={
          aiReady
            ? '按本章正文生成 3 种章纲（均衡 / 悬疑钩子 / 电影感），挑一个采用'
            : '按本章正文的标题与段落整理出章纲（开启 AI 后可一次生成多种方案）'
        }
      >
        <button
          type="button"
          className={styles.primary}
          disabled={!canGenerate || busy}
          onClick={aiReady ? onGenerateVariants : onRebuild}
        >
          {busy ? '处理中…' : aiReady ? '生成章纲' : '从正文整理'}
        </button>
      </Tooltip>
      <Tooltip content="更多：导入、生成设置、保存为版本、清空">
        <button
          ref={moreRef}
          type="button"
          className={styles.iconButton}
          aria-label="章纲更多操作"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <AiOutlineEllipsis />
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={moreRef}
        placement="bottom"
        align="end"
        offset={4}
        role="presentation"
        onClose={() => setOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={styles.menu} role="menu" aria-label="章纲更多操作">
          {aiReady && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={!canGenerate || busy}
              onClick={() => run(onRebuild)}
            >
              从正文整理（不用 AI）
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            disabled={busy}
            onClick={() => run(onImport)}
          >
            导入大纲文件…
          </button>
          {aiReady && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => run(onTogglePreset)}
            >
              {presetOpen ? '收起生成设置' : '生成设置（粒度 / 层数）'}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            disabled={!hasPersisted || busy}
            onClick={() => run(onSaveVersion)}
          >
            保存为大纲版本
          </button>
          {hasPersisted && (
            <button
              type="button"
              role="menuitem"
              className={`${styles.item} ${styles.danger}`}
              disabled={busy}
              onClick={() => run(onClear)}
            >
              清空章纲
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
};

export default OutlineToolbar;
