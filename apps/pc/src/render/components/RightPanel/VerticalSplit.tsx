import React, { useState, useCallback } from 'react';
import styles from './styles.module.scss';

export const VerticalSplit: React.FC<{
  top: React.ReactNode;
  bottom: React.ReactNode;
  initialTopHeight: number;
}> = ({ top, bottom, initialTopHeight }) => {
  const [topHeight, setTopHeight] = useState(initialTopHeight);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = topHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const nextHeight = Math.max(140, startHeight + (moveEvent.clientY - startY));
        setTopHeight(nextHeight);
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [topHeight]
  );

  return (
    <div
      className={styles.verticalSplit}
      style={{ gridTemplateRows: `${topHeight}px 12px minmax(0, 1fr)` }}
    >
      <div className={styles.splitPane}>{top}</div>
      <div className={styles.splitHandle} onMouseDown={handleMouseDown} />
      <div className={styles.splitPane}>{bottom}</div>
    </div>
  );
};
