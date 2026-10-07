import React, { useEffect, useState } from 'react';
import { AUDIO_MIME_TYPES, detectAudioFormat } from '@novel-editor/video';
import styles from './styles.module.scss';

/**
 * 试听：按需读取音频字节（配音 / 配乐 / 音效，均经主进程校验路径）并生成 blob 地址，用原生 audio 播放；
 * 文件变化或卸载时释放。没有 source 时不渲染。
 */
const AudioPreview: React.FC<{
  /** 变化时重新读取（文件名 / 相对路径） */
  source: string | null;
  load: (source: string) => Promise<Uint8Array>;
  label: string;
  testId?: string;
}> = ({ source, load, label, testId }) => {
  const [entry, setEntry] = useState<{ source: string; url: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!source) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    setError('');
    load(source)
      .then((bytes) => {
        if (cancelled) return;
        const format = detectAudioFormat(bytes);
        const type = format ? AUDIO_MIME_TYPES[format] : 'audio/mpeg';
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
        setEntry({ source, url: created });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [load, source]);

  if (!source) return null;
  if (error) return <span className={styles.status}>无法读取音频：{error}</span>;
  if (!entry || entry.source !== source) return <span className={styles.status}>读取中…</span>;
  return (
    <audio
      className={styles.audio}
      src={entry.url}
      controls
      preload="metadata"
      aria-label={label}
      data-testid={testId}
    />
  );
};

export default AudioPreview;
