/**
 * 音频 / 视频预览
 */
import React, { useState } from 'react';
import VideoPlayer, { AudioPlayer } from '../../VideoPlayer';
import styles from './styles.module.scss';
import { formatByteSize, formatDuration } from '../utils';

interface MediaPreviewProps {
  dataUrl: string;
  mimeType: string;
  byteSize: number;
}

export const AudioPreview: React.FC<MediaPreviewProps> = ({ dataUrl, mimeType, byteSize }) => {
  const [metadata, setMetadata] = useState<{ source: string; duration: number | null } | null>(
    null
  );
  const duration = metadata?.source === dataUrl ? metadata.duration : null;

  return (
    <div className={styles.mediaPanel}>
      <AudioPlayer
        key={dataUrl}
        className={styles.audioPlayer}
        src={{ src: dataUrl, mimeType }}
        title="音频预览"
        onMetadata={({ duration }) =>
          setMetadata({ source: dataUrl, duration: Number.isFinite(duration) ? duration : null })
        }
      />
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
    <VideoPlayer
      src={{ src: dataUrl, mimeType }}
      title="视频预览"
      kind="video"
      className={styles.previewVideo}
      maxHeight="min(72vh, 760px)"
    />
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
