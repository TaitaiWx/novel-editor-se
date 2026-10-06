import React, { useRef, useState } from 'react';
import { AiOutlineBook, AiOutlineCheck, AiOutlineDown, AiOutlinePlus } from 'react-icons/ai';
import Popover from '../../Popover';
import type { WorkScopeOption } from '../../../utils/workScope';
import styles from './styles.module.scss';

export const UNASSIGNED_WORK_HINT =
  '项目根目录下不属于任何作品的旧资料与人物 / 设定（旧版布局遗留），可整理到各作品中';

interface WorkSwitcherProps {
  current: WorkScopeOption;
  options: WorkScopeOption[];
  /** 作品路径 → 章数 */
  chapterCounts: Record<string, number>;
  onSelect: (path: string) => void;
  onCreate?: () => void;
}

function metaOf(option: WorkScopeOption, chapterCounts: Record<string, number>): string {
  if (option.kind === 'unassigned') return '旧资料';
  return `${chapterCounts[option.path] ?? 0}章`;
}

/**
 * 作品切换器（文件面板顶部）：角色、设定、成长档案、资料都跟随当前作品。
 * 下拉列出项目中的作品（带章数）、旧版遗留的「未归属」，以及「新建作品」。
 */
const WorkSwitcher: React.FC<WorkSwitcherProps> = ({
  current,
  options,
  chapterCounts,
  onSelect,
  onCreate,
}) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const close = () => setOpen(false);

  return (
    <div className={styles.workSwitcher}>
      <button
        ref={anchorRef}
        type="button"
        className={`${styles.trigger}${open ? ` ${styles.triggerOpen}` : ''}`}
        aria-label={`当前作品：${current.name}，点击切换作品`}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="work-switcher"
        title={current.kind === 'unassigned' ? UNASSIGNED_WORK_HINT : `当前作品「${current.name}」`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.icon}>
          <AiOutlineBook />
        </span>
        <span className={styles.label}>
          <span className={styles.eyebrow}>当前作品</span>
          <span className={styles.name}>{current.name}</span>
        </span>
        <span className={styles.meta}>{metaOf(current, chapterCounts)}</span>
        <AiOutlineDown className={styles.chevron} />
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        placement="bottom"
        align="start"
        offset={4}
        role="presentation"
        className={styles.popover}
        closeOnOutsideClick
        closeOnEscape
        onClose={close}
      >
        <div role="listbox" aria-label="作品" className={styles.list}>
          {options.map((option) => {
            const selected = option.path === current.path;
            return (
              <button
                key={`${option.kind}:${option.path}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`${styles.option}${selected ? ` ${styles.optionSelected}` : ''}`}
                title={option.kind === 'unassigned' ? UNASSIGNED_WORK_HINT : undefined}
                onClick={() => {
                  close();
                  if (!selected) onSelect(option.path);
                }}
              >
                <span className={styles.check}>{selected ? <AiOutlineCheck /> : null}</span>
                <span
                  className={`${styles.optionName}${
                    option.kind === 'unassigned' ? ` ${styles.optionMuted}` : ''
                  }`}
                >
                  {option.name}
                </span>
                <span className={styles.optionMeta}>{metaOf(option, chapterCounts)}</span>
              </button>
            );
          })}
        </div>
        {onCreate && (
          <button
            type="button"
            className={styles.createButton}
            onClick={() => {
              close();
              onCreate();
            }}
          >
            <AiOutlinePlus />
            <span>新建作品</span>
          </button>
        )}
      </Popover>
    </div>
  );
};

export default WorkSwitcher;
