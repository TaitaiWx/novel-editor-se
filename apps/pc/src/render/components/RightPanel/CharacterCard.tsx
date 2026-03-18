import React, { useMemo } from 'react';
import type { Character } from './types';
import { getRoleColor } from './utils';
import styles from './styles.module.scss';

export const CharacterCard: React.FC<{
  character: Character;
  index: number;
  dragIndex: number | null;
  dropIndex: number | null;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDelete: (index: number) => void;
}> = React.memo(
  ({
    character: c,
    index: i,
    dragIndex,
    dropIndex,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    onDelete,
  }) => {
    const roleColor = useMemo(() => (c.role ? getRoleColor(c.role) : null), [c.role]);
    const truncDesc = useMemo(
      () => (c.description.length > 80 ? c.description.slice(0, 80) + '...' : c.description),
      [c.description]
    );

    return (
      <React.Fragment>
        {dropIndex === i && dragIndex !== null && dragIndex > i && (
          <div className={styles.dropIndicator} />
        )}
        <div
          className={`${styles.characterCard} ${dragIndex === i ? styles.dragging : ''}`}
          draggable={true}
          onDragStart={(e) => onDragStart(e, i)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOver(e, i)}
          onDragEnter={(e) => onDragEnter(e, i)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, i)}
        >
          <div className={styles.cardBody}>
            {c.avatar && (
              <img src={c.avatar} alt={c.name} className={styles.cardAvatar} draggable={false} />
            )}
            <div className={styles.cardInfo}>
              <div className={styles.cardHeader}>
                <span className={styles.dragHandle}>⠿</span>
                <span className={styles.cardName}>{c.name}</span>
                {roleColor && (
                  <span
                    className={styles.cardRole}
                    style={{
                      backgroundColor: `${roleColor}1a`,
                      color: roleColor,
                    }}
                  >
                    {c.role}
                  </span>
                )}
                <button
                  className={styles.deleteCardButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(i);
                  }}
                  title="删除角色"
                >
                  ×
                </button>
              </div>
              {c.description && <div className={styles.cardDesc}>{truncDesc}</div>}
            </div>
          </div>
        </div>
        {dropIndex === i && dragIndex !== null && dragIndex < i && (
          <div className={styles.dropIndicator} />
        )}
      </React.Fragment>
    );
  }
);
