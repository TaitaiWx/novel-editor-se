import React, { useEffect, useState } from 'react';
import { loadAvatarSource } from '../../utils/characterAvatar';
import styles from './styles.module.scss';

interface CharacterAvatarProps {
  name: string;
  /** 人物卡的形象图（相对作品目录的路径 / data URL / 网络地址）；已解析好的地址用 src */
  avatar?: string;
  /** 已解析好的可显示地址（优先于 avatar） */
  src?: string | null;
  workPath?: string | null;
  color?: string;
  size?: number;
  className?: string;
}

/**
 * 小圆头像：人物在「引用 / 链接」处的显示方式（人物关系、场景视频画布等）。
 * 与人物详情的竖版形象图是同一张图，这里裁成圆形；没有图时显示首字。
 */
const CharacterAvatar: React.FC<CharacterAvatarProps> = ({
  name,
  avatar,
  src: givenSrc,
  workPath = null,
  color = '#9cdcfe',
  size = 24,
  className,
}) => {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (givenSrc !== undefined) return;
    let cancelled = false;
    void loadAvatarSource(avatar, workPath).then((value) => {
      if (!cancelled) setLoaded(value);
    });
    return () => {
      cancelled = true;
    };
  }, [avatar, givenSrc, workPath]);
  const src = givenSrc !== undefined ? givenSrc : loaded;
  const style = {
    '--avatar-accent': color,
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${Math.round(size * 0.45)}px`,
  } as React.CSSProperties;
  return src ? (
    <img
      className={`${styles.avatar} ${className ?? ''}`}
      style={style}
      src={src}
      alt=""
      draggable={false}
    />
  ) : (
    <span className={`${styles.initial} ${className ?? ''}`} style={style} aria-hidden="true">
      {Array.from(name.trim())[0] ?? '?'}
    </span>
  );
};

export default CharacterAvatar;
