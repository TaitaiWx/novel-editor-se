import React, { useState } from 'react';
import { VscCheck, VscLoading } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import { MediaImage } from '../../EntityGallery/MediaTile';
import styles from './styles.module.scss';

export interface KeyframeSectionProps {
  label: string;
  workPath: string | null;
  /** 已采用的首帧（相对作品目录） */
  keyframe?: string;
  /** 预演截图（相对作品目录） */
  previz?: string;
  /** 是否已配置图片服务 */
  imageReady: boolean;
  onOpenPreviz: () => void;
  onGenerate: () => Promise<string[]>;
  onAdopt: (dataUrl: string) => Promise<void>;
  onClear: () => void;
}

/**
 * 镜头的首帧（可选）：先 3D 预演摆好构图（可跳过），再一键生成 4 张首帧挑一张。
 * 人物参考图（三视图）与预演截图自动带上；采用后生成视频时从这张首帧开始。
 */
const KeyframeSection: React.FC<KeyframeSectionProps> = ({
  label,
  workPath,
  keyframe,
  previz,
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
            <MediaImage path={previz} workPath={workPath} alt={`${label} 预演截图`} />
          ) : (
            <span className={styles.muted}>还没有预演</span>
          )}
          <figcaption>预演构图</figcaption>
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
      <div className={styles.inlineActions}>
        <Tooltip content="用木偶小人摆站位、姿势和机位，截图作为首帧的构图参考（可跳过）">
          <button type="button" className={styles.button} onClick={onOpenPreviz}>
            {previz ? '重新预演' : '3D 预演'}
          </button>
        </Tooltip>
        <Tooltip
          content={
            imageReady
              ? '按画面描述 + 人物三视图 + 预演构图生成 4 张首帧，挑一张采用'
              : '先在设置中心配置图片服务（Seedream / MiniMax / Grok 图片）'
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
