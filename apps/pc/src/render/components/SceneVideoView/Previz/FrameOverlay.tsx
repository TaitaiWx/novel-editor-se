/**
 * 预演视口上的 DOM 叠加层：画幅取景框（框外遮罩）、三分线、安全框、人物名字标签。
 * 都是 DOM，不在 WebGL 画布里，因此不会进截图 / 视频。
 */
import React from 'react';
import { frameRect } from './presets';
import type { PrevizLabel } from './types';
import styles from './styles.module.scss';

export interface PrevizOverlays {
  thirds: boolean;
  safe: boolean;
}

interface FrameOverlayProps {
  width: number;
  height: number;
  aspect: number;
  aspectLabel: string;
  overlays: PrevizOverlays;
  labels: readonly PrevizLabel[];
  figures: readonly { id: string; name: string; color: string }[];
  activeId: string | null;
}

const FrameOverlay: React.FC<FrameOverlayProps> = ({
  width,
  height,
  aspect,
  aspectLabel,
  overlays,
  labels,
  figures,
  activeId,
}) => {
  if (width <= 0 || height <= 0) return null;
  const rect = frameRect(width, height, aspect);
  const byId = new Map(figures.map((figure) => [figure.id, figure]));
  return (
    <div className={styles.overlayLayer} aria-hidden data-testid="previz-overlay">
      <div
        className={styles.frameMask}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        <span className={styles.frameTag}>{aspectLabel}</span>
        {overlays.thirds && (
          <div className={styles.thirds} data-testid="previz-thirds">
            <i style={{ left: '33.333%' }} />
            <i style={{ left: '66.667%' }} />
            <b style={{ top: '33.333%' }} />
            <b style={{ top: '66.667%' }} />
          </div>
        )}
        {overlays.safe && <div className={styles.safeArea} data-testid="previz-safe" />}
      </div>
      {labels.map((label) => {
        const figure = byId.get(label.id);
        if (!figure || !label.visible) return null;
        return (
          <span
            key={label.id}
            className={label.id === activeId ? styles.nameTagActive : styles.nameTag}
            style={{ left: label.x, top: label.y }}
          >
            <span className={styles.dot} style={{ background: figure.color }} />
            {figure.name}
          </span>
        );
      })}
    </div>
  );
};

export default FrameOverlay;
