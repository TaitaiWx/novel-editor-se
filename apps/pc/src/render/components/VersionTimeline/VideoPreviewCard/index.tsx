/**
 * VideoPreviewCard — 视频版本预览卡片（播放器 + 元信息）
 */
import React from 'react';
import { formatByteSize } from '../utils';
import styles from './styles.module.scss';

export interface VideoPreviewCardProps {
  title: string;
  dataUrl?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  emptyText: string;
}

const VideoPreviewCard: React.FC<VideoPreviewCardProps> = ({
  title,
  dataUrl,
  mimeType,
  byteSize,
  emptyText,
}) => {
  return (
    <div className={styles.audioComparePane}>
      <div className={styles.audioCompareLabel}>{title}</div>
      {dataUrl ? (
        <>
          <video className={styles.videoPlayer} src={dataUrl} controls preload="metadata" />
          <div className={styles.videoMetaGrid}>
            <div className={styles.videoMetaItem}>
              <span className={styles.videoMetaLabel}>MIME</span>
              <span className={styles.videoMetaValue}>{mimeType ?? '未知'}</span>
            </div>
            <div className={styles.videoMetaItem}>
              <span className={styles.videoMetaLabel}>大小</span>
              <span className={styles.videoMetaValue}>{formatByteSize(byteSize)}</span>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.previewPlaceholder}>{emptyText}</div>
      )}
    </div>
  );
};

export default VideoPreviewCard;
