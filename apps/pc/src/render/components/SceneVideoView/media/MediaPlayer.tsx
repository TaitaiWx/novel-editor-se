import React, { useEffect, useState } from 'react';
import VideoPlayer from '../../VideoPlayer';
import styles from './styles.module.scss';

export type ReadSceneFile = (fileName: string) => Promise<Uint8Array>;

function mimeOf(fileName: string): string {
  return /\.webm$/i.test(fileName) ? 'video/webm' : 'video/mp4';
}

/**
 * 读取场景目录内的视频（主进程校验文件名与路径）并生成 blob 地址；文件变化或卸载时释放
 */
export function useSceneMediaUrl(
  readFile: ReadSceneFile,
  fileName: string | null
): { url: string | null; error: string } {
  const [entry, setEntry] = useState<{ fileName: string; url: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!fileName) {
      setEntry(null);
      setError('');
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setError('');
    readFile(fileName)
      .then((bytes) => {
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(fileName) }));
        setEntry({ fileName, url: created });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setEntry(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [fileName, readFile]);

  return { url: entry && entry.fileName === fileName ? entry.url : null, error };
}

export interface MediaPlayerProps {
  readFile: ReadSceneFile;
  fileName: string | null;
  caption?: string;
  testId?: string;
  emptyText?: string;
}

/** 本地成片播放器（只播放场景目录内的文件） */
const MediaPlayer: React.FC<MediaPlayerProps> = ({
  readFile,
  fileName,
  caption,
  testId,
  emptyText = '还没有可预览的视频',
}) => {
  const { url, error } = useSceneMediaUrl(readFile, fileName);
  return (
    <figure className={styles.player}>
      <div className={styles.playerFrame}>
        {url ? (
          <VideoPlayer
            src={url}
            title={caption ?? fileName ?? '视频预览'}
            videoTestId={testId}
            maxHeight={360}
          />
        ) : (
          <span className={styles.playerEmpty}>
            {error ? `无法读取视频：${error}` : fileName ? '读取中…' : emptyText}
          </span>
        )}
      </div>
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
    </figure>
  );
};

export default MediaPlayer;
