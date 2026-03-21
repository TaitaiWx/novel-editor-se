import React from 'react';
import type { ActNode } from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';
import type { PlotActBoard } from './types';
import { ACT_COLORS } from './constants';
import { createActBoardKey, mergeActBoard } from './utils';

interface ActCardsBoardProps {
  acts: ActNode[];
  plotBoards: Record<string, PlotActBoard>;
  activeAct: number | null;
  activeScene: string | null;
  sceneDragKey: string | null;
  onActClick: (actIdx: number, line: number) => void;
  onSceneClick: (e: React.MouseEvent, sceneKey: string, line: number) => void;
  onSceneDragStart: (sceneKey: string) => void;
  onSceneDrop: (targetKey: string) => void;
}

export const ActCardsBoard: React.FC<ActCardsBoardProps> = React.memo(
  ({
    acts,
    plotBoards,
    activeAct,
    activeScene,
    sceneDragKey: _sceneDragKey,
    onActClick,
    onSceneClick,
    onSceneDragStart,
    onSceneDrop,
  }) => (
    <div className={styles.storyBoardWrap}>
      <div className={styles.storyBoardHeader}>
        <span>幕结构卡</span>
        <span className={styles.sectionSubtle}>点击卡片选中幕，拖拽场景芯片可重排</span>
      </div>
      <div className={styles.storyBoardScroller}>
        {acts.map((act, actIdx) => {
          const color = ACT_COLORS[actIdx % ACT_COLORS.length];
          const isActActive = activeAct === actIdx;
          const boardKey = createActBoardKey(act, actIdx);
          const board = mergeActBoard(act, actIdx, plotBoards[boardKey]);
          const sceneCount = board.sceneBoards.length;
          const completeCount = board.sceneBoards.filter((s) => s.status === 'done').length;

          return (
            <div
              key={actIdx}
              className={`${styles.storyActCard} ${isActActive ? styles.storyActCardActive : ''}`}
              onClick={() => onActClick(actIdx, act.line)}
              style={{ borderTopColor: color }}
            >
              <div className={styles.storyActTop}>
                <span className={styles.storyActTitle}>{act.title}</span>
                <span className={styles.storyActMeta}>
                  {completeCount}/{sceneCount}
                </span>
              </div>
              {act.scenes.length > 0 && (
                <div className={styles.storyActRange}>
                  {act.scenes[0].title} — {act.scenes[act.scenes.length - 1].title}
                </div>
              )}
              <div className={styles.storyTempoTrack}>
                {board.sceneBoards.length === 0 ? (
                  <span className={styles.storyTempoEmpty}>暂无场景</span>
                ) : (
                  board.sceneBoards.map((sceneBoard, index) => {
                    const sceneKey = `${actIdx}-${index}`;
                    const sceneLine = act.scenes[index]?.line ?? act.line;
                    const isSceneActive = activeScene === sceneKey;
                    const statusClass =
                      sceneBoard.status === 'done'
                        ? styles.tempoDone
                        : sceneBoard.status === 'ready'
                          ? styles.tempoReady
                          : styles.tempoDraft;
                    return (
                      <button
                        key={sceneBoard.sceneKey}
                        className={`${styles.storySceneChip} ${isSceneActive ? styles.storySceneChipActive : ''} ${statusClass}`}
                        draggable={isActActive}
                        onDragStart={() => onSceneDragStart(sceneBoard.sceneKey)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onSceneDrop(sceneBoard.sceneKey)}
                        onClick={(e) => onSceneClick(e, sceneKey, sceneLine)}
                      >
                        <span>{index + 1}</span>
                        <em>{sceneBoard.title}</em>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  )
);
