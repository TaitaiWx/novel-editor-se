import React from 'react';
import styles from './styles.module.scss';

interface PanelResizerProps {
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 无障碍名称，例如“调整左侧面板宽度” */
  label?: string;
}

/**
 * 卡片之间的竖向拖拽把手，占据卡片间距本身。
 * 宽度状态与边界裁剪由父组件负责。
 */
export const PanelResizer: React.FC<PanelResizerProps> = ({ onMouseDown, label }) => (
  <div
    className={styles.panelResizer}
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    onMouseDown={onMouseDown}
  />
);
