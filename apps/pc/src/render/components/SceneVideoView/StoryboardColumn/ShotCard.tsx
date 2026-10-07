import React, { useState } from 'react';
import { VscArrowDown, VscArrowUp, VscGripper, VscTrash } from 'react-icons/vsc';
import {
  SHOT_DURATION_MAX,
  SHOT_DURATION_MIN,
  SHOT_SIZES,
  type Shot,
  type ShotSize,
} from '@novel-editor/video';
import styles from './styles.module.scss';

export interface ShotCardProps {
  shot: Shot;
  index: number;
  total: number;
  selected: boolean;
  /** 最近一次生成任务的状态文案（没有任务时不显示） */
  status?: { text: string; tone: 'active' | 'done' | 'failed' | 'muted' };
  dragging: boolean;
  onToggleSelect: () => void;
  onChange: (patch: Partial<Omit<Shot, 'id'>>) => void;
  onRemove: () => void;
  onMove: (offset: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
}

/** 一个镜头卡片：景别、时长、画面描述、运镜、台词；可勾选、拖动排序、上下移动、删除 */
const ShotCard: React.FC<ShotCardProps> = ({
  shot,
  index,
  total,
  selected,
  status,
  dragging,
  onToggleSelect,
  onChange,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
  onDropOn,
}) => {
  const [dropTarget, setDropTarget] = useState(false);
  const label = `镜头 ${index + 1}`;
  return (
    <li
      className={`${styles.card} ${selected ? styles.cardSelected : ''} ${
        dropTarget ? styles.cardDropTarget : ''
      } ${dragging ? styles.cardDragging : ''}`}
      data-shot-id={shot.id}
      aria-label={label}
      onDragOver={(event) => {
        event.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropTarget(false);
        onDropOn();
      }}
    >
      <div className={styles.cardHead}>
        <span
          className={styles.grip}
          draggable
          title="拖动调整顺序"
          aria-hidden="true"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', shot.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          <VscGripper />
        </span>
        <label className={styles.cardTitle}>
          <input
            type="checkbox"
            checked={selected}
            aria-label={`选择${label}`}
            onChange={onToggleSelect}
          />
          {label}
        </label>
        {status && (
          <span className={styles.status} data-tone={status.tone}>
            {status.text}
          </span>
        )}
        <span className={styles.cardActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`上移${label}`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <VscArrowUp />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`下移${label}`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <VscArrowDown />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`删除${label}`}
            onClick={onRemove}
          >
            <VscTrash />
          </button>
        </span>
      </div>

      <div className={styles.metaRow}>
        <select
          className={styles.select}
          aria-label={`${label} 景别`}
          value={shot.shotSize}
          onChange={(event) => onChange({ shotSize: event.target.value as ShotSize })}
        >
          {SHOT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <label className={styles.duration}>
          <input
            type="number"
            className={styles.input}
            aria-label={`${label} 时长（秒）`}
            min={SHOT_DURATION_MIN}
            max={SHOT_DURATION_MAX}
            step={1}
            value={shot.durationSec}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value)) return;
              onChange({
                durationSec: Math.min(SHOT_DURATION_MAX, Math.max(SHOT_DURATION_MIN, value)),
              });
            }}
          />
          <span>秒</span>
        </label>
        <input
          className={styles.input}
          aria-label={`${label} 运镜`}
          value={shot.camera ?? ''}
          placeholder="运镜，例如：缓慢推近"
          onChange={(event) => onChange({ camera: event.target.value })}
        />
      </div>

      <textarea
        className={styles.textarea}
        aria-label={`${label} 画面描述`}
        rows={3}
        value={shot.description}
        placeholder="画面描述：主体 + 动作 + 环境 + 光线"
        onChange={(event) => onChange({ description: event.target.value })}
      />
      <input
        className={styles.input}
        aria-label={`${label} 台词`}
        value={shot.dialogue ?? ''}
        placeholder="台词 / 旁白（可选，仅供剪辑参考）"
        onChange={(event) => onChange({ dialogue: event.target.value || undefined })}
      />
      {!shot.description.trim() && <p className={styles.cardHint}>写一句画面描述后才能生成</p>}
    </li>
  );
};

export default ShotCard;
