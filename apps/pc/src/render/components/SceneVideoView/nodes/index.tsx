import React from 'react';
import { VscDebugRestart, VscLoading, VscPlay } from 'react-icons/vsc';
import type { Shot } from '@novel-editor/video';
import Tooltip from '../../Tooltip';
import CharacterAvatar from '../../CharacterAvatar';
import { useSceneMediaUrl, type ReadSceneFile } from '../media/MediaPlayer';
import { MediaImage } from '../../EntityGallery/MediaTile';
import type { ShotProgress } from '../sceneVideoState';
import styles from './styles.module.scss';

function ratioStyle(aspectRatio: string): React.CSSProperties {
  const [w, h] = aspectRatio.split(':').map(Number);
  return { aspectRatio: w > 0 && h > 0 ? `${w} / ${h}` : '16 / 9' };
}

// ─── 人物 ───────────────────────────────────────────────────────────────

/** 人物节点：标题行（头像 + 名字）+ 三视图（生成视频时自动作为人物参考图） */
export const CharacterNode: React.FC<{
  name: string;
  avatar?: string;
  turnaround?: string;
  workPath: string | null;
}> = ({ name, avatar, turnaround, workPath }) => (
  <div className={styles.characterCard}>
    <div className={styles.character}>
      <CharacterAvatar name={name} src={avatar ?? null} size={24} />
      <span className={styles.characterName}>{name}</span>
      {!turnaround && (
        <Tooltip content="人物详情 → 图集里上传或生成一张三视图，生成视频时人物不容易崩">
          <span className={styles.characterHint}>缺三视图</span>
        </Tooltip>
      )}
    </div>
    <div className={styles.turnaround} data-testid="character-turnaround">
      {turnaround ? (
        <MediaImage path={turnaround} workPath={workPath} alt={`${name} 的三视图`} />
      ) : (
        <span className={styles.thumbText}>{avatar ? '用主要形象图作参考' : '没有参考图'}</span>
      )}
    </div>
  </div>
);

// ─── 场景 ───────────────────────────────────────────────────────────────

export const SceneNode: React.FC<{
  chapter: string;
  scene: string;
  sourceText: string;
  location: string;
  splitting: boolean;
  onResplit: () => void;
}> = ({ chapter, scene, sourceText, location, splitting, onResplit }) => (
  <div className={styles.body}>
    <header className={styles.header}>
      <span className={styles.kind}>场景</span>
      <span className={styles.title}>{scene}</span>
      <Tooltip content="按场景正文重新拆分镜（会替换当前分镜，已生成的成片保留）">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="重新拆分镜"
          disabled={splitting || !sourceText.trim()}
          onClick={onResplit}
        >
          {splitting ? <VscLoading className={styles.spin} /> : <VscDebugRestart />}
        </button>
      </Tooltip>
    </header>
    <p className={styles.meta}>
      {chapter}
      {location ? ` · ${location}` : ''}
    </p>
    <p className={`${styles.excerpt} ${sourceText.trim() ? '' : styles.placeholder}`}>
      {sourceText.trim() || '还没有场景正文：单击这里，在右侧粘贴或改写这一场'}
    </p>
    {splitting && <p className={styles.status}>正在拆分镜…</p>}
  </div>
);

// ─── 镜头 ───────────────────────────────────────────────────────────────

const ShotThumb: React.FC<{ readFile: ReadSceneFile; fileName: string; label: string }> = ({
  readFile,
  fileName,
  label,
}) => {
  const { url, error } = useSceneMediaUrl(readFile, fileName);
  if (!url) {
    return <span className={styles.thumbText}>{error ? '无法读取成片' : '读取中…'}</span>;
  }
  return (
    <video
      className={styles.thumbVideo}
      src={url}
      muted
      loop
      playsInline
      preload="metadata"
      data-testid="shot-video"
      aria-label={`${label} 成片`}
      onMouseEnter={(event) => void event.currentTarget.play().catch(() => undefined)}
      onMouseLeave={(event) => event.currentTarget.pause()}
    />
  );
};

export interface ShotNodeProps {
  shot: Shot;
  index: number;
  aspectRatio: string;
  progress: ShotProgress;
  canGenerate: boolean;
  /** 不能生成的原因（tooltip） */
  generateBlockedReason?: string;
  readFile: ReadSceneFile;
  /** 采用的首帧（相对作品目录）：还没有成片时显示在缩略图位置 */
  keyframe?: string;
  workPath?: string | null;
  onGenerate: () => void;
}

export const ShotNode: React.FC<ShotNodeProps> = ({
  shot,
  index,
  aspectRatio,
  progress,
  canGenerate,
  generateBlockedReason,
  readFile,
  keyframe,
  workPath = null,
  onGenerate,
}) => {
  const label = `镜头 ${index + 1}`;
  const regenerate = progress.kind === 'done' || progress.kind === 'failed';
  const busy = progress.kind === 'active';
  const tip = !canGenerate
    ? (generateBlockedReason ?? '暂不能生成')
    : regenerate
      ? '重新生成这个镜头（保留之前的版本）'
      : '生成这个镜头';
  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <span className={styles.kind}>{label}</span>
        <span className={styles.title}>
          {shot.shotSize} · {shot.durationSec}s
        </span>
        <Tooltip content={tip}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`${regenerate ? '重新生成' : '生成'}${label}`}
            disabled={!canGenerate || busy}
            onClick={onGenerate}
          >
            {regenerate ? <VscDebugRestart /> : <VscPlay />}
          </button>
        </Tooltip>
      </header>
      <div className={styles.thumb} style={ratioStyle(aspectRatio)} data-state={progress.kind}>
        {progress.kind === 'done' ? (
          <ShotThumb readFile={readFile} fileName={progress.fileName} label={label} />
        ) : progress.kind === 'active' ? (
          <span className={styles.thumbText}>
            {progress.text}
            {progress.progress !== null && (
              <span
                className={styles.progress}
                role="progressbar"
                aria-valuenow={Math.round(progress.progress)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.min(100, Math.max(2, progress.progress))}%` }} />
              </span>
            )}
          </span>
        ) : progress.kind === 'failed' ? (
          <span className={`${styles.thumbText} ${styles.thumbFailed}`}>
            生成失败：{progress.text}
          </span>
        ) : keyframe ? (
          <MediaImage path={keyframe} workPath={workPath} alt={`${label} 首帧`} />
        ) : (
          <span className={styles.thumbText}>{shot.camera || '未生成'}</span>
        )}
        {progress.kind !== 'done' && keyframe && <span className={styles.versionBadge}>首帧</span>}
        {progress.kind === 'done' && (
          <span className={styles.versionBadge}>
            v{progress.version}
            {progress.versions > 1 ? ` / ${progress.versions}` : ''}
          </span>
        )}
      </div>
      <p className={`${styles.description} ${shot.description.trim() ? '' : styles.placeholder}`}>
        {shot.description.trim() || '写一句画面描述后才能生成'}
      </p>
    </div>
  );
};

// ─── 样片 ───────────────────────────────────────────────────────────────

export const OutputNode: React.FC<{
  aspectRatio: string;
  readFile: ReadSceneFile;
  animatic: string | null;
  doneCount: number;
  totalCount: number;
  stitchProgress: number | null;
}> = ({ aspectRatio, readFile, animatic, doneCount, totalCount, stitchProgress }) => {
  const { url } = useSceneMediaUrl(readFile, animatic);
  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <span className={styles.kind}>样片</span>
        <span className={styles.title}>
          {totalCount > 0 ? `${doneCount} / ${totalCount} 个镜头` : '还没有镜头'}
        </span>
      </header>
      <div className={styles.thumb} style={ratioStyle(aspectRatio)}>
        {stitchProgress !== null ? (
          <span className={styles.thumbText}>合成中 {Math.round(stitchProgress)}%</span>
        ) : url ? (
          <video
            className={styles.thumbVideo}
            src={url}
            controls
            preload="metadata"
            data-testid="scene-video-animatic"
            aria-label="样片"
          />
        ) : (
          <span className={styles.thumbText}>全部镜头生成后自动合成样片</span>
        )}
      </div>
      <p className={styles.meta}>{animatic ?? '保存在 资料/视频/ 下，可在左侧资料中查看'}</p>
    </div>
  );
};
