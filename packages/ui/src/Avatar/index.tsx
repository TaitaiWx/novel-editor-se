import React from 'react';
import styles from './styles.module.scss';

export interface AvatarProps {
  name: string;
  src?: string | null;
  color?: string;
  size?: number;
  className?: string;
}

/** 圆形头像；资源地址由调用方解析，无图片时显示首字。 */
const Avatar: React.FC<AvatarProps> = ({ name, src, color = '#9cdcfe', size = 24, className }) => {
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

export default Avatar;
