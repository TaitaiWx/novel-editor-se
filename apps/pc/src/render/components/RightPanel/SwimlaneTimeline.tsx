import React, { useMemo, useCallback, useRef, useState } from 'react';
import type { PlotSceneBoard, PlotActBoard } from './types';
import { INTENSITY_COLORS } from './constants';
import styles from './styles.module.scss';

interface SwimlaneTimelineProps {
  board: PlotActBoard;
  activeScene: string | null;
  onSceneClick: (sceneKey: string) => void;
  onSceneDragReorder: (sourceKey: string, targetKey: string) => void;
}

interface SwimlaneRow {
  pov: string;
  color: string;
  scenes: (PlotSceneBoard | null)[];
}

const POV_COLORS = [
  '#d7ba7d',
  '#4ec9b0',
  '#c586c0',
  '#dcdcaa',
  '#b5cea8',
  '#f14c4c',
  '#d8b08e',
  '#e2c08d',
];

export const SwimlaneTimeline: React.FC<SwimlaneTimelineProps> = React.memo(
  ({ board, activeScene, onSceneClick, onSceneDragReorder }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [dragSource, setDragSource] = useState<string | null>(null);
    const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

    // Build swimlane rows grouped by POV
    const { rows, maxColumns } = useMemo(() => {
      const povMap = new Map<string, PlotSceneBoard[]>();
      const scenesWithPov = board.sceneBoards.map((s) => ({
        ...s,
        pov: s.pov?.trim() || '未分配',
      }));

      // Accumulate scenes per POV
      for (const scene of scenesWithPov) {
        const existing = povMap.get(scene.pov) || [];
        existing.push(scene);
        povMap.set(scene.pov, existing);
      }

      const builtRows: SwimlaneRow[] = [];
      let colorIdx = 0;
      let maxCols = 0;

      for (const [pov, scenes] of povMap) {
        // Place scenes in their chronological order
        const rowScenes: (PlotSceneBoard | null)[] = [];
        for (const scene of scenes) {
          const globalIdx = board.sceneBoards.findIndex((s) => s.sceneKey === scene.sceneKey);
          while (rowScenes.length <= globalIdx) rowScenes.push(null);
          rowScenes[globalIdx] = scene;
        }
        maxCols = Math.max(maxCols, rowScenes.length);
        builtRows.push({
          pov,
          color: POV_COLORS[colorIdx % POV_COLORS.length],
          scenes: rowScenes,
        });
        colorIdx++;
      }

      // Ensure all rows have same length
      for (const row of builtRows) {
        while (row.scenes.length < maxCols) row.scenes.push(null);
      }

      return { rows: builtRows, maxColumns: maxCols };
    }, [board.sceneBoards]);

    const handleDragStart = useCallback((sceneKey: string) => {
      setDragSource(sceneKey);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, sceneKey: string) => {
      e.preventDefault();
      setDragOverTarget(sceneKey);
    }, []);

    const handleDrop = useCallback(
      (targetKey: string) => {
        if (dragSource && dragSource !== targetKey) {
          onSceneDragReorder(dragSource, targetKey);
        }
        setDragSource(null);
        setDragOverTarget(null);
      },
      [dragSource, onSceneDragReorder]
    );

    const handleDragEnd = useCallback(() => {
      setDragSource(null);
      setDragOverTarget(null);
    }, []);

    if (board.sceneBoards.length === 0) {
      return <div className={styles.emptyHint}>当前幕没有场景，请先在正文中标记"第X场"</div>;
    }

    return (
      <div className={styles.swimlaneContainer}>
        {/* Column headers (time axis) */}
        <div
          className={styles.swimlaneGrid}
          ref={scrollRef}
          style={{
            gridTemplateColumns: `120px repeat(${maxColumns}, minmax(140px, 1fr))`,
          }}
        >
          {/* Top-left corner label */}
          <div className={styles.swimlaneCorner}>POV ╲ 时间</div>

          {/* Column headers */}
          {Array.from({ length: maxColumns }, (_, i) => (
            <div key={`header-${i}`} className={styles.swimlaneColHeader}>
              <span>{i + 1}</span>
            </div>
          ))}

          {/* Rows */}
          {rows.map((row) => (
            <React.Fragment key={row.pov}>
              {/* Row label */}
              <div className={styles.swimlaneRowLabel} style={{ borderLeftColor: row.color }}>
                <span className={styles.swimlanePovDot} style={{ background: row.color }} />
                {row.pov}
              </div>

              {/* Scene cells */}
              {row.scenes.map((scene, colIdx) => (
                <div
                  key={`${row.pov}-${colIdx}`}
                  className={`${styles.swimlaneCell} ${
                    scene && activeScene === scene.sceneKey ? styles.swimlaneCellActive : ''
                  } ${
                    scene && dragOverTarget === scene.sceneKey ? styles.swimlaneCellDropTarget : ''
                  }`}
                  onDragOver={scene ? (e) => handleDragOver(e, scene.sceneKey) : undefined}
                  onDrop={scene ? () => handleDrop(scene.sceneKey) : undefined}
                >
                  {scene ? (
                    <div
                      className={`${styles.swimlaneCard} ${
                        dragSource === scene.sceneKey ? styles.swimlaneCardDragging : ''
                      }`}
                      style={{
                        borderLeftColor: row.color,
                        background: `linear-gradient(135deg, ${INTENSITY_COLORS[Math.min(scene.intensity || 1, 5) - 1]}, rgba(18, 22, 30, 0.85))`,
                      }}
                      draggable
                      onDragStart={() => handleDragStart(scene.sceneKey)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onSceneClick(scene.sceneKey)}
                    >
                      <div className={styles.swimlaneCardTitle}>{scene.title}</div>
                      {scene.objective && (
                        <div className={styles.swimlaneCardMeta}>
                          <span style={{ color: '#4ec9b0' }}>◎</span> {scene.objective}
                        </div>
                      )}
                      {scene.tension && (
                        <div className={styles.swimlaneCardMeta}>
                          <span style={{ color: '#f14c4c' }}>⚡</span> {scene.tension}
                        </div>
                      )}
                      <div className={styles.swimlaneStatusDot}>
                        <span className={styles[`swimlaneStatus_${scene.status}`]} />
                      </div>
                    </div>
                  ) : (
                    <div className={styles.swimlaneEmptyCell} />
                  )}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }
);
