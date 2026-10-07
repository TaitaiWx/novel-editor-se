import React, { useMemo, useState } from 'react';
import { VscLink, VscPlay } from 'react-icons/vsc';
import type { AIProviderInfo, VideoSettingsInfo, VideoTask } from '@/render/types/ai-api';
import {
  animaticFiles,
  estimateSceneCost,
  shotNumber,
  type SceneVideoState,
} from '../sceneVideoState';
import MediaPlayer, { type ReadSceneFile } from './MediaPlayer';
import TaskList from './TaskList';
import VersionsPanel from './VersionsPanel';
import styles from './styles.module.scss';

export interface PreviewColumnProps {
  state: SceneVideoState;
  onChange: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  files: readonly string[];
  tasks: readonly VideoTask[];
  provider: AIProviderInfo | null;
  settings: VideoSettingsInfo | null;
  submitting: boolean;
  onSubmit: (scope: 'selected' | 'all') => void;
  onCancelTask: (id: string) => void;
  onRetryTask: (id: string) => void;
  readFile: ReadSceneFile;
  stitchProgress: number | null;
  stitchSupported: boolean;
  onStitch: () => void;
  onLinkOutline: () => void;
  linkDisabled: boolean;
}

function money(amount: number, currency: 'CNY' | 'USD' | undefined): string {
  return `${currency === 'USD' ? '$' : '¥'}${amount.toFixed(2)}`;
}

/** 右栏「预览与任务」：费用预估、提交生成、任务队列、版本对比、拼接样片、回链章纲 */
const PreviewColumn: React.FC<PreviewColumnProps> = ({
  state,
  onChange,
  files,
  tasks,
  provider,
  settings,
  submitting,
  onSubmit,
  onCancelTask,
  onRetryTask,
  readFile,
  stitchProgress,
  stitchSupported,
  onStitch,
  onLinkOutline,
  linkDisabled,
}) => {
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const shots = state.storyboard.shots;
  const selectedShots = shots.filter((shot) => state.selectedShotIds.includes(shot.id));
  const estimate = estimateSceneCost(selectedShots, provider);
  const animatics = animaticFiles(files);
  const positionByNumber = useMemo(
    () =>
      new Map(
        shots
          .map((shot, index) => [shotNumber(shot), index + 1] as const)
          .filter((entry): entry is readonly [number, number] => entry[0] !== null)
      ),
    [shots]
  );
  // 默认预览：最新的样片，否则最近完成的成片
  const latestDone = tasks.find((task) => task.status === 'succeeded' && task.outputPath);
  const defaultPreview =
    animatics[0] ?? (latestDone?.outputPath ? latestDone.outputPath.split('/').pop() : null);
  const previewFile =
    pickedPreview && files.includes(pickedPreview) ? pickedPreview : (defaultPreview ?? null);
  const canSubmit = Boolean(provider) && !submitting;
  const limits = [
    settings?.perTaskLimit !== undefined
      ? `单镜上限 ${money(settings.perTaskLimit, provider?.currency)}`
      : '',
    settings?.dailyLimit !== undefined
      ? `每日上限 ${money(settings.dailyLimit, provider?.currency)}`
      : '',
  ].filter(Boolean);

  return (
    <section className={styles.column} aria-label="预览与任务">
      <h2 className={styles.title}>预览与任务</h2>

      <MediaPlayer
        readFile={readFile}
        fileName={previewFile}
        caption={previewFile ?? undefined}
        testId="scene-video-preview"
        emptyText="生成完成的镜头或拼接的样片会在这里播放"
      />

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>生成</h3>
        <p className={styles.estimate} data-testid="scene-video-estimate">
          {estimate.text}
        </p>
        {limits.length > 0 && <p className={styles.muted}>{limits.join(' · ')}</p>}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canSubmit || selectedShots.length === 0}
            onClick={() => onSubmit('selected')}
          >
            {submitting ? '提交中…' : '生成选中镜头'}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!canSubmit || shots.length === 0}
            onClick={() => onSubmit('all')}
          >
            全部生成
          </button>
        </div>
        {!provider && (
          <p className={styles.softNote}>
            配置视频服务后即可生成；现在可以先编辑分镜、导出分镜表。
          </p>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>任务</h3>
        <TaskList
          tasks={tasks}
          positionByNumber={positionByNumber}
          onCancel={onCancelTask}
          onRetry={onRetryTask}
        />
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>版本</h3>
        <VersionsPanel
          state={state}
          files={files}
          previewFile={previewFile}
          compare={compare}
          readFile={readFile}
          onPreview={setPickedPreview}
          onChoose={(shotId, fileName) =>
            onChange((prev) => ({
              ...prev,
              chosenVersions: { ...prev.chosenVersions, [shotId]: fileName },
            }))
          }
          onToggleCompare={(fileName) =>
            setCompare((prev) =>
              prev.includes(fileName)
                ? prev.filter((item) => item !== fileName)
                : [...prev, fileName].slice(-2)
            )
          }
        />
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>样片与回链</h3>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={!stitchSupported || stitchProgress !== null || selectedShots.length === 0}
            title={
              stitchSupported
                ? '把选中镜头选用的版本拼成一条样片（没有成片的镜头用占位卡）'
                : '当前环境不支持 WebCodecs'
            }
            onClick={onStitch}
          >
            <VscPlay aria-hidden="true" />
            {stitchProgress !== null ? `拼接中 ${Math.round(stitchProgress)}%` : '拼接预览'}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={linkDisabled}
            title="在本章章纲里加一条指向分镜表与成片的记录"
            onClick={onLinkOutline}
          >
            <VscLink aria-hidden="true" />
            回链到章纲
          </button>
        </div>
        {animatics.length > 0 && (
          <ul className={styles.animatics}>
            {animatics.map((fileName) => (
              <li key={fileName}>
                <button
                  type="button"
                  className={`${styles.linkButton} ${
                    previewFile === fileName ? styles.linkButtonActive : ''
                  }`}
                  onClick={() => setPickedPreview(fileName)}
                >
                  {fileName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default PreviewColumn;
