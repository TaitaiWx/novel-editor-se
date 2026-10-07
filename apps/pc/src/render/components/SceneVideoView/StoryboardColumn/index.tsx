import React, { useState } from 'react';
import { VscAdd, VscExport, VscSparkle } from 'react-icons/vsc';
import { STORYBOARD_MAX_SHOTS, storyboardDurationSec } from '@novel-editor/video';
import {
  appendShot,
  moveShot,
  removeShot,
  updateShot,
  type SceneVideoState,
} from '../sceneVideoState';
import ShotCard, { type ShotCardProps } from './ShotCard';
import styles from './styles.module.scss';

export interface StoryboardColumnProps {
  state: SceneVideoState;
  onChange: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  /** 有可用的文本服务（否则按段落拆分） */
  aiReady: boolean;
  generating: boolean;
  notes: readonly string[];
  statusByShot: Readonly<Record<string, ShotCardProps['status']>>;
  onGenerate: () => void;
  onExport: () => void;
}

/** 中栏「分镜」：AI 生成 / 按段落拆分、编辑镜头卡片、拖动排序、勾选要生成的镜头、导出分镜表 */
const StoryboardColumn: React.FC<StoryboardColumnProps> = ({
  state,
  onChange,
  aiReady,
  generating,
  notes,
  statusByShot,
  onGenerate,
  onExport,
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const shots = state.storyboard.shots;
  const selected = new Set(state.selectedShotIds);
  const allSelected = shots.length > 0 && shots.every((shot) => selected.has(shot.id));
  const total = Math.round(storyboardDurationSec(state.storyboard));
  const hasSource = Boolean(state.sourceText.trim());

  const reorder = (fromId: string, toId: string) =>
    onChange((prev) => ({
      ...prev,
      storyboard: { ...prev.storyboard, shots: moveShot(prev.storyboard.shots, fromId, toId) },
    }));

  return (
    <section className={styles.column} aria-label="分镜">
      <div className={styles.titleRow}>
        <h2 className={styles.title}>分镜</h2>
        <span className={styles.meta}>
          {shots.length ? `${shots.length} 个镜头 · 共 ${total} 秒` : '还没有镜头'}
        </span>
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={generating || !hasSource}
          title={aiReady ? '用 AI 把场景拆成 3–6 个镜头' : '未配置 AI：按段落 / 句子拆分'}
          onClick={onGenerate}
        >
          <VscSparkle aria-hidden="true" />
          {generating ? '生成中…' : 'AI 生成分镜'}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={shots.length >= STORYBOARD_MAX_SHOTS}
          onClick={() => onChange(appendShot)}
        >
          <VscAdd aria-hidden="true" />
          添加镜头
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={shots.length === 0}
          onClick={onExport}
        >
          <VscExport aria-hidden="true" />
          导出分镜表
        </button>
      </div>

      {!aiReady && (
        <p className={styles.softNote}>
          还没有配置 AI 文本服务：「AI 生成分镜」会按段落 / 句子拆分，之后可以逐镜修改。
        </p>
      )}
      {notes.length > 0 && (
        <ul className={styles.notes} role="status">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {shots.length === 0 ? (
        <div className={styles.empty}>
          {hasSource ? '点「AI 生成分镜」把这一场拆成镜头，或手动添加镜头' : '先在左侧填写场景正文'}
        </div>
      ) : (
        <>
          <label className={styles.selectAll}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                onChange((prev) => ({
                  ...prev,
                  selectedShotIds: allSelected ? [] : prev.storyboard.shots.map((shot) => shot.id),
                }))
              }
            />
            全选（已选 {state.selectedShotIds.length} 个）
          </label>
          <ol className={styles.cards}>
            {shots.map((shot, index) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                index={index}
                total={shots.length}
                selected={selected.has(shot.id)}
                status={statusByShot[shot.id]}
                dragging={dragId === shot.id}
                onToggleSelect={() =>
                  onChange((prev) => ({
                    ...prev,
                    selectedShotIds: prev.selectedShotIds.includes(shot.id)
                      ? prev.selectedShotIds.filter((id) => id !== shot.id)
                      : prev.storyboard.shots
                          .map((item) => item.id)
                          .filter((id) => id === shot.id || prev.selectedShotIds.includes(id)),
                  }))
                }
                onChange={(patch) => onChange((prev) => updateShot(prev, shot.id, patch))}
                onRemove={() => onChange((prev) => removeShot(prev, shot.id))}
                onMove={(offset) => {
                  const target = shots[index + offset];
                  if (target) reorder(shot.id, target.id);
                }}
                onDragStart={() => setDragId(shot.id)}
                onDragEnd={() => setDragId(null)}
                onDropOn={() => {
                  if (dragId && dragId !== shot.id) reorder(dragId, shot.id);
                  setDragId(null);
                }}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );
};

export default StoryboardColumn;
