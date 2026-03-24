import React, { useCallback, useState } from 'react';
import styles from './styles.module.scss';
import type { PlotSceneBoard } from './types';
import { PLOT_STATUS_LABELS, INTENSITY_COLORS, INTENSITY_LABELS } from './constants';
import { FlowCollapsibleCard } from './FlowCards';

interface SceneBoardCardProps {
  sceneBoard: PlotSceneBoard;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  allSceneKeys: string[];
  onUpdate: (partial: Partial<PlotSceneBoard>) => void;
  onMove: (direction: -1 | 1) => void;
  onAiSuggest?: (sceneKey: string) => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}

const STATUS_ICONS: Record<PlotSceneBoard['status'], string> = {
  draft: '○',
  ready: '◐',
  done: '●',
};

/** Brief preview text for collapsed card */
function buildPreview(s: PlotSceneBoard): string {
  const parts: string[] = [];
  if (s.objective) parts.push(s.objective);
  if (s.tension) parts.push(s.tension);
  if (s.outcome) parts.push(s.outcome);
  return parts.join(' → ') || '';
}

export const SceneBoardCard: React.FC<SceneBoardCardProps> = React.memo(
  ({
    sceneBoard,
    index,
    canMoveUp,
    canMoveDown,
    allSceneKeys,
    onUpdate,
    onMove,
    onAiSuggest,
    draggable,
    onDragStart,
    onDragOver,
    onDrop,
  }) => {
    const [expanded, setExpanded] = useState(false);
    const intensity = sceneBoard.intensity ?? 1;
    const intensityColor = INTENSITY_COLORS[Math.min(intensity, 5) - 1];

    const handleAddBeat = useCallback(() => {
      onUpdate({ beats: [...(sceneBoard.beats || []), ''] });
    }, [sceneBoard.beats, onUpdate]);

    const handleBeatChange = useCallback(
      (beatIdx: number, value: string) => {
        const next = [...(sceneBoard.beats || [])];
        next[beatIdx] = value;
        onUpdate({ beats: next });
      },
      [sceneBoard.beats, onUpdate]
    );

    const handleRemoveBeat = useCallback(
      (beatIdx: number) => {
        const next = (sceneBoard.beats || []).filter((_, i) => i !== beatIdx);
        onUpdate({ beats: next });
      },
      [sceneBoard.beats, onUpdate]
    );

    const preview = buildPreview(sceneBoard);

    return (
      <div
        style={{ '--scene-accent': intensityColor } as React.CSSProperties}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <FlowCollapsibleCard
          title={
            <>
              <span className={styles.sceneCard2Index}>{index + 1}</span>
              {sceneBoard.title}
            </>
          }
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          tone={expanded ? 'accent' : 'default'}
          meta={
            <div className={styles.sceneCard2Actions}>
              <div
                className={styles.sceneIntensityBar}
                title={`张力: ${INTENSITY_LABELS[intensity - 1]}`}
              >
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    className={`${styles.intensityDot} ${level <= intensity ? styles.intensityDotActive : ''}`}
                    style={
                      level <= intensity ? { background: INTENSITY_COLORS[level - 1] } : undefined
                    }
                    title={INTENSITY_LABELS[level - 1]}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate({ intensity: level });
                    }}
                  />
                ))}
              </div>
              <button
                className={`${styles.sceneStatusButton} ${styles[`sceneStatus_${sceneBoard.status}`]}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const order: PlotSceneBoard['status'][] = ['draft', 'ready', 'done'];
                  const cur = order.indexOf(sceneBoard.status);
                  onUpdate({ status: order[(cur + 1) % 3] });
                }}
                title={PLOT_STATUS_LABELS[sceneBoard.status]}
              >
                {STATUS_ICONS[sceneBoard.status]}
              </button>
            </div>
          }
          summary={
            !expanded && preview ? (
              <span className={styles.sceneCard2Preview}>{preview}</span>
            ) : undefined
          }
        >
          {/* ── Core three-field: Goal / Conflict / Outcome ── */}
          <div className={styles.sceneStructuredFields}>
            <div className={styles.sceneField}>
              <span className={`${styles.sceneFieldDot} ${styles.sceneFieldDotGoal}`} />
              <div className={styles.sceneFieldBody}>
                <label>目标</label>
                <input
                  type="text"
                  value={sceneBoard.objective}
                  onChange={(e) => onUpdate({ objective: e.target.value })}
                  placeholder="这个场景要推进什么剧情？角色想要达成什么？"
                />
              </div>
            </div>
            <div className={styles.sceneField}>
              <span className={`${styles.sceneFieldDot} ${styles.sceneFieldDotConflict}`} />
              <div className={styles.sceneFieldBody}>
                <label>冲突</label>
                <input
                  type="text"
                  value={sceneBoard.tension}
                  onChange={(e) => onUpdate({ tension: e.target.value })}
                  placeholder="什么力量在阻碍目标？内心挣扎还是外部冲突？"
                />
              </div>
            </div>
            <div className={styles.sceneField}>
              <span className={`${styles.sceneFieldDot} ${styles.sceneFieldDotOutcome}`} />
              <div className={styles.sceneFieldBody}>
                <label>结果</label>
                <input
                  type="text"
                  value={sceneBoard.outcome}
                  onChange={(e) => onUpdate({ outcome: e.target.value })}
                  placeholder="场景结束后局势如何变化？留下什么悬念？"
                />
              </div>
            </div>
          </div>

          {/* ── Secondary fields ── */}
          <div className={styles.sceneSecondaryFields}>
            <div className={styles.sceneFieldInline}>
              <label>视角</label>
              <input
                type="text"
                value={sceneBoard.pov || ''}
                onChange={(e) => onUpdate({ pov: e.target.value })}
                placeholder="谁的视角讲述？"
              />
            </div>
            <div className={styles.sceneFieldInline}>
              <label>人物</label>
              <input
                type="text"
                value={(sceneBoard.characters || []).join(', ')}
                onChange={(e) =>
                  onUpdate({
                    characters: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="逗号分隔: 李明, 王芳"
              />
            </div>
          </div>

          {/* ── Causal link ── */}
          <div className={styles.sceneFieldInline}>
            <label>因果</label>
            <select
              value={sceneBoard.causesScene || ''}
              onChange={(e) => onUpdate({ causesScene: e.target.value || null })}
            >
              <option value="">此场景不直接触发其他场景</option>
              {allSceneKeys
                .filter((k) => k !== sceneBoard.sceneKey)
                .map((k, i) => (
                  <option key={k} value={k}>
                    场景 {i + 1}
                  </option>
                ))}
            </select>
          </div>

          {/* ── Beats ── */}
          <div className={styles.sceneBeatsZone}>
            <div className={styles.sceneBeatsHeader}>
              <label>节拍</label>
              <span className={styles.sceneBeatsHint}>场景内的关键动作节点</span>
              <button onClick={handleAddBeat}>+ 添加</button>
            </div>
            {(sceneBoard.beats || []).map((beat, bi) => (
              <div key={bi} className={styles.sceneBeatRow}>
                <span className={styles.sceneBeatNum}>{bi + 1}</span>
                <input
                  type="text"
                  value={beat}
                  onChange={(e) => handleBeatChange(bi, e.target.value)}
                  placeholder={`第 ${bi + 1} 个节拍: 发生了什么关键事件？`}
                />
                <button className={styles.sceneBeatRemove} onClick={() => handleRemoveBeat(bi)}>
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* ── Bottom toolbar ── */}
          <div className={styles.sceneCardToolbar}>
            <div className={styles.sceneCardToolbarLeft}>
              <button
                className={styles.sceneMoveButton}
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
                title="上移场景"
              >
                ↑
              </button>
              <button
                className={styles.sceneMoveButton}
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
                title="下移场景"
              >
                ↓
              </button>
            </div>
            {onAiSuggest && (
              <button
                className={styles.sceneAiButton}
                onClick={() => onAiSuggest(sceneBoard.sceneKey)}
              >
                AI 补充建议
              </button>
            )}
          </div>
        </FlowCollapsibleCard>
      </div>
    );
  }
);
