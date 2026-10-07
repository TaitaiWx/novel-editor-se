import React, { useRef, useState } from 'react';
import { AiOutlineDown, AiOutlineEllipsis } from 'react-icons/ai';
import {
  STRUCTURE_ORDER,
  STRUCTURE_TEMPLATES,
  getStructureLabel,
  type VolumeStructureId,
} from '@novel-editor/basic-algorithm';
import Popover from '../../Popover';
import Tooltip from '../../Tooltip';
import styles from './styles.module.scss';

/** 结构选项的一句话说明（菜单副标题） */
export function describeStructure(id: VolumeStructureId): string {
  if (id === 'markers') return '按正文里的「第X幕」分段';
  return STRUCTURE_TEMPLATES[id].stages.map((stage) => stage.title).join(' → ');
}

/** 可选结构：正文没有幕标记时不提供「按正文幕标记」 */
export function structureOptions(hasMarkers: boolean): VolumeStructureId[] {
  return STRUCTURE_ORDER.filter((id) => hasMarkers || id !== 'markers');
}

interface PlanToolbarProps {
  structure: VolumeStructureId;
  hasMarkers: boolean;
  onSelectStructure: (id: VolumeStructureId) => void;
  /** 「⋯」菜单里的内容（生成记录与清除操作） */
  moreContent: React.ReactNode;
}

/** 列表视图工具行：结构选择（直接列出全部结构，而不是盲目轮换）+「⋯ 更多」 */
export const PlanToolbar: React.FC<PlanToolbarProps> = ({
  structure,
  hasMarkers,
  onSelectStructure,
  moreContent,
}) => {
  const structureRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [structureOpen, setStructureOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className={styles.structureRow}>
      <span className={styles.structureLabel}>结构</span>
      <Tooltip content="按哪种结构给本卷分段（只影响卷纲，不改正文）" position="bottom">
        <button
          ref={structureRef}
          type="button"
          className={styles.structureChip}
          aria-haspopup="menu"
          aria-expanded={structureOpen}
          aria-label={`卷纲结构：${getStructureLabel(structure)}`}
          onClick={() => setStructureOpen((open) => !open)}
        >
          {getStructureLabel(structure)}
          <AiOutlineDown aria-hidden="true" />
        </button>
      </Tooltip>
      <span className={styles.toolbarSpacer} />
      <Tooltip content="更多操作" position="bottom">
        <button
          ref={moreRef}
          type="button"
          className={styles.iconButton}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-label="卷纲更多操作"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <AiOutlineEllipsis />
        </button>
      </Tooltip>

      <Popover
        open={structureOpen}
        anchorRef={structureRef}
        placement="bottom"
        align="start"
        offset={4}
        role="presentation"
        onClose={() => setStructureOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={styles.menu} role="menu" aria-label="卷纲结构">
          {structureOptions(hasMarkers).map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === structure}
              className={`${styles.menuItem} ${id === structure ? styles.menuItemActive : ''}`}
              onClick={() => {
                setStructureOpen(false);
                if (id !== structure) onSelectStructure(id);
              }}
            >
              <span className={styles.menuItemTitle}>{getStructureLabel(id)}</span>
              <span className={styles.menuItemHint}>{describeStructure(id)}</span>
            </button>
          ))}
        </div>
      </Popover>
      <Popover
        open={moreOpen}
        anchorRef={moreRef}
        placement="bottom"
        align="end"
        offset={4}
        role="dialog"
        onClose={() => setMoreOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={`${styles.menu} ${styles.morePanel}`} aria-label="卷纲更多操作">
          {moreContent}
        </div>
      </Popover>
    </div>
  );
};
