import React, { useState } from 'react';
import { VscCheck, VscLoading } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import { MediaImage } from '../../EntityGallery/MediaTile';
import MediaPlayer, { type ReadSceneFile } from '../media/MediaPlayer';
import styles from './styles.module.scss';

export interface KeyframeSectionProps {
  label: string;
  workPath: string | null;
  /** 已采用的首帧（相对作品目录） */
  keyframe?: string;
  /** 预演第一帧（相对作品目录） */
  previz?: string;
  /** 预演视频（相对作品目录，镜头N-预演.mp4） */
  previzVideo?: string;
  /** 预演脚本：每次保存都是新对象，预演视频同名覆盖后据此重新读取 */
  previzScript?: object;
  /** 读取场景目录内的视频（主进程校验文件名） */
  readFile?: ReadSceneFile;
  /** 是否已配置图片服务 */
  imageReady: boolean;
  onOpenPreviz: () => void;
  onGenerate: () => Promise<string[]>;
  onAdopt: (dataUrl: string) => Promise<void>;
  onClear: () => void;
}

const revisions = new WeakMap<object, number>();
let nextRevision = 1;
/** 对象 → 递增编号（同一对象编号不变） */
function revisionOf(value: object | undefined): number {
  if (!value) return 0;
  let revision = revisions.get(value);
  if (!revision) {
    revision = nextRevision++;
    revisions.set(value, revision);
  }
  return revision;
}

/**
 * 镜头的首帧（可选）：先 3D 预演（描述动作 → AI 生成可播放的走位动画，可跳过），再一键生成 4 张首帧挑一张。
 * 人物参考图（三视图）与预演第一帧自动带上；采用后生成视频时从这张首帧开始。
 * 预演视频是作者的动作参考（将来也可交给支持视频参考的模型）。
 */
const KeyframeSection: React.FC<KeyframeSectionProps> = ({
  label,
  workPath,
  keyframe,
  previz,
  previzVideo,
  previzScript,
  readFile,
  imageReady,
  onOpenPreviz,
  onGenerate,
  onAdopt,
  onClear,
}) => {
  const [candidates, setCandidates] = useState<string[]>([]);
  const [busy, setBusy] = useState<'generate' | 'adopt' | null>(null);
  const [error, setError] = useState('');

  const generate = async () => {
    setBusy('generate');
    setError('');
    try {
      setCandidates(await onGenerate());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const adopt = async (dataUrl: string) => {
    setBusy('adopt');
    setError('');
    try {
      await onAdopt(dataUrl);
      setCandidates([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.field} aria-label={`${label} 首帧`} data-testid="keyframe-section">
      <span className={styles.label}>首帧（可选，让人物和构图更稳）</span>
      <div className={styles.keyframeRow}>
        <figure className={styles.keyframeThumb}>
          {previz ? (
            <MediaImage path={previz} workPath={workPath} alt={`${label} 预演第一帧`} />
          ) : (
            <span className={styles.muted}>还没有预演</span>
          )}
          <figcaption>预演第一帧（构图）</figcaption>
        </figure>
        <figure className={styles.keyframeThumb}>
          {keyframe ? (
            <MediaImage path={keyframe} workPath={workPath} alt={`${label} 首帧`} />
          ) : (
            <span className={styles.muted}>还没有首帧</span>
          )}
          <figcaption>首帧</figcaption>
        </figure>
      </div>
      {previzVideo && readFile && (
        <div data-testid="previz-video-preview">
          <MediaPlayer
            key={revisionOf(previzScript)}
            readFile={readFile}
            fileName={previzVideo.split('/').pop() ?? null}
            caption="预演视频（动作参考）"
            testId="previz-video"
          />
        </div>
      )}
      <div className={styles.inlineActions}>
        <Tooltip content="描述动作与走位，AI 生成一段木偶预演动画；第一帧作为首帧的构图参考（可跳过）">
          <button type="button" className={styles.button} onClick={onOpenPreviz}>
            {previz ? '重新预演' : '3D 预演'}
          </button>
        </Tooltip>
        <Tooltip
          content={
            imageReady
              ? '按画面描述 + 人物三视图 + 预演第一帧生成 4 张首帧，挑一张采用'
              : '先在设置中心「AI → 图片」里添加图片模型'
          }
        >
          <button
            type="button"
            className={styles.button}
            disabled={!imageReady || busy !== null}
            onClick={() => void generate()}
          >
            {busy === 'generate' ? (
              <>
                <VscLoading aria-hidden="true" /> 生成中…
              </>
            ) : keyframe ? (
              '重新生成首帧'
            ) : (
              '生成首帧（4 选 1）'
            )}
          </button>
        </Tooltip>
        {keyframe && (
          <button type="button" className={styles.linkButton} onClick={onClear}>
            不用首帧
          </button>
        )}
      </div>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
      {candidates.length > 0 && (
        <div className={styles.candidates} role="listbox" aria-label="首帧候选">
          {candidates.map((dataUrl, index) => (
            <button
              key={index}
              type="button"
              role="option"
              aria-selected={false}
              aria-label={`采用首帧候选 ${index + 1}`}
              className={styles.candidate}
              disabled={busy !== null}
              onClick={() => void adopt(dataUrl)}
            >
              <img src={dataUrl} alt="" />
              <span className={styles.candidateHint}>
                <VscCheck aria-hidden="true" /> 采用
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export default KeyframeSection;
