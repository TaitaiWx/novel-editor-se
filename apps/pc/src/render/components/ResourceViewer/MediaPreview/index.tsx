/**
 * 音频 / 视频预览
 */
import React, { useState } from 'react';
import styles from './styles.module.scss';
import { formatByteSize, formatDuration } from '../utils';

interface MediaPreviewProps {
  dataUrl: string;
  mimeType: string;
  byteSize: number;
}

export const AudioPreview: React.FC<MediaPreviewProps> = ({ dataUrl, mimeType, byteSize }) => {
  const [duration, setDuration] = useState<number | null>(null);

  return (
    <div className={styles.mediaPanel}>
      <audio
        className={styles.audioPlayer}
        controls
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(
            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null
          );
        }}
      >
        <source src={dataUrl} type={mimeType} />
      </audio>
      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>类型</span>
          <span className={styles.metaValue}>{mimeType}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>大小</span>
          <span className={styles.metaValue}>{formatByteSize(byteSize)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>时长</span>
          <span className={styles.metaValue}>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
};

export const VideoPreview: React.FC<MediaPreviewProps> = ({ dataUrl, mimeType, byteSize }) => (
  <div className={styles.mediaPanel}>
    <video className={styles.previewVideo} controls preload="metadata">
      <source src={dataUrl} type={mimeType} />
    </video>
    <div className={styles.metaGrid}>
      <div className={styles.metaItem}>
        <span className={styles.metaLabel}>类型</span>
        <span className={styles.metaValue}>{mimeType}</span>
      </div>
      <div className={styles.metaItem}>
        <span className={styles.metaLabel}>大小</span>
        <span className={styles.metaValue}>{formatByteSize(byteSize)}</span>
      </div>
    </div>
  </div>
);
