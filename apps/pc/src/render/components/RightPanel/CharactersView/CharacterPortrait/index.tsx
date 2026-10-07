import React, { useEffect, useRef, useState } from 'react';
import { loadAvatarSource } from '../../../../utils/characterAvatar';
import styles from './styles.module.scss';

interface CharacterPortraitProps {
  name: string;
  /** 人物卡的形象图（attributes.avatar：相对作品目录的路径，或旧数据中的 data URL / 网络地址） */
  avatar?: string;
  color?: string;
  /** 作品目录：图片保存到 <作品>/资料/人物头像/ */
  workPath: string | null;
  /** 保存成功后写回人物卡（相对作品目录的路径） */
  onChange: (avatar: string) => Promise<void> | void;
  /** 提供时点击形象图打开图集（在图集里上传 / AI 生成 / 选封面），而不是直接选本地文件 */
  onOpenGallery?: () => void;
}

export const PORTRAIT_HINT = '形象图保存在 资料/人物头像/；正文悬停卡片等处会裁成圆形头像显示';

/**
 * 人物详情的形象图（立绘）：以竖版大图完整展示，点击从本地选择图片更换。
 * 同一张图在悬停卡片、场景视频等「引用人物」的地方裁成小圆头像，这里不裁成头像。
 * 图片交给主进程校验并保存到 <作品>/资料/人物头像/，人物卡只保存相对路径。
 */
export const CharacterPortrait: React.FC<CharacterPortraitProps> = ({
  name,
  avatar,
  color = '#9cdcfe',
  workPath,
  onChange,
  onOpenGallery,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAvatarSource(avatar, workPath).then((value) => {
      if (!cancelled) setSrc(value);
    });
    return () => {
      cancelled = true;
    };
  }, [avatar, workPath]);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !workPath) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await window.electron.ipcRenderer.invoke(
        'character-avatar-save',
        workPath,
        name,
        bytes
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await onChange(result.data.relativePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const initial = Array.from(name.trim())[0] ?? '?';
  return (
    <figure className={styles.portrait} data-testid="character-portrait">
      <button
        type="button"
        className={`${styles.frame} ${src ? '' : styles.frameEmpty}`}
        style={{ '--portrait-accent': color } as React.CSSProperties}
        onClick={() => (onOpenGallery ? onOpenGallery() : inputRef.current?.click())}
        disabled={!workPath || busy}
        aria-label={src ? `更换 ${name} 的形象图` : `为 ${name} 添加形象图`}
        title={onOpenGallery ? '打开图集：上传、AI 生成或从图集中选一张作形象图' : PORTRAIT_HINT}
      >
        {src ? (
          <img src={src} alt={`${name} 的形象图`} draggable={false} />
        ) : (
          <span className={styles.placeholder}>
            <span className={styles.initial}>{initial}</span>
            <span className={styles.placeholderText}>添加形象图</span>
          </span>
        )}
        {src && (
          <span className={styles.overlay} aria-hidden="true">
            {busy ? '保存中…' : '更换形象图'}
          </span>
        )}
        {!src && busy && (
          <span className={styles.overlay} aria-hidden="true">
            保存中…
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(event) => void handleFile(event)}
        data-testid="character-avatar-input"
      />
      {error && (
        <figcaption className={styles.error} role="alert">
          {error}
        </figcaption>
      )}
    </figure>
  );
};

export default CharacterPortrait;
