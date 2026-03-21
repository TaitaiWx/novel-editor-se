import React from 'react';
import styles from './styles.module.scss';

interface PanelResizerProps {
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * A slim vertical drag handle placed between two flex panels.
 * The parent is responsible for tracking width state and clamping bounds.
 */
export const PanelResizer: React.FC<PanelResizerProps> = ({ onMouseDown }) => (
  <div className={styles.panelResizer} onMouseDown={onMouseDown} />
);
