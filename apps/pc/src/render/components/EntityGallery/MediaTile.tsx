import React, { useEffect, useState } from 'react';
import { loadAvatarSource } from '../../utils/characterAvatar';
import styles from './styles.module.scss';

/** 读取图集里的一张图（相对作品目录的路径 / data URL），返回可显示的地址 */
export function useMediaSource(path: string | undefined, workPath: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAvatarSource(path, workPath).then((value) => {
      if (!cancelled) setSrc(value);
    });
    return () => {
      cancelled = true;
    };
  }, [path, workPath]);
  return src;
}

export const MediaImage: React.FC<{
  path: string;
  workPath: string | null;
  alt: string;
  className?: string;
}> = ({ path, workPath, alt, className }) => {
  const src = useMediaSource(path, workPath);
  return src ? (
    <img className={className} src={src} alt={alt} draggable={false} />
  ) : (
    <span className={`${styles.tilePlaceholder} ${className ?? ''}`}>读取中…</span>
  );
};
