import React, { useMemo, useRef } from 'react';
import type { PlotSceneBoard, PlotActBoard } from './types';
import { INTENSITY_COLORS } from './constants';
import styles from './styles.module.scss';

interface CausalChainViewProps {
  board: PlotActBoard;
  activeScene: string | null;
  onSceneClick: (sceneKey: string) => void;
}

interface NodePosition {
  x: number;
  y: number;
  scene: PlotSceneBoard;
  index: number;
}

const NODE_W = 180;
const NODE_H = 80;
const GAP_X = 60;
const GAP_Y = 40;
const PADDING = 24;

export const CausalChainView: React.FC<CausalChainViewProps> = React.memo(
  ({ board, activeScene, onSceneClick }) => {
    const canvasRef = useRef<HTMLDivElement>(null);

    // Layout nodes as a DAG (directed acyclic graph)
    const { nodes, edges, width, height } = useMemo(() => {
      const scenes = board.sceneBoards;
      if (scenes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

      // Build adjacency from causesScene
      const keyToIdx = new Map<string, number>();
      scenes.forEach((s, i) => keyToIdx.set(s.sceneKey, i));

      // Simple topological layering
      const inDegree = new Array(scenes.length).fill(0);
      const adjList: number[][] = scenes.map(() => []);

      for (let i = 0; i < scenes.length; i++) {
        const target = scenes[i].causesScene;
        if (target && keyToIdx.has(target)) {
          const targetIdx = keyToIdx.get(target)!;
          adjList[i].push(targetIdx);
          inDegree[targetIdx]++;
        }
      }

      // Assign layers via BFS
      const layers: number[][] = [];
      const layerOf = new Array(scenes.length).fill(-1);
      const queue: number[] = [];

      // Start with scenes that have no incoming causal edges
      for (let i = 0; i < scenes.length; i++) {
        if (inDegree[i] === 0) {
          queue.push(i);
          layerOf[i] = 0;
        }
      }

      // BFS
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        for (const next of adjList[cur]) {
          if (layerOf[next] === -1 || layerOf[next] < layerOf[cur] + 1) {
            layerOf[next] = layerOf[cur] + 1;
            queue.push(next);
          }
        }
      }

      // Assign unconnected nodes to layer based on their order
      for (let i = 0; i < scenes.length; i++) {
        if (layerOf[i] === -1) layerOf[i] = 0;
      }

      // Group by layer
      const maxLayer = Math.max(0, ...layerOf);
      for (let l = 0; l <= maxLayer; l++) {
        layers[l] = [];
      }
      for (let i = 0; i < scenes.length; i++) {
        layers[layerOf[i]].push(i);
      }

      // Compute positions
      const builtNodes: NodePosition[] = [];
      const maxRowSize = Math.max(1, ...layers.map((l) => l.length));
      const totalW = maxRowSize * (NODE_W + GAP_X) - GAP_X + PADDING * 2;
      const totalH = layers.length * (NODE_H + GAP_Y) - GAP_Y + PADDING * 2;

      for (let layer = 0; layer < layers.length; layer++) {
        const row = layers[layer];
        const rowWidth = row.length * (NODE_W + GAP_X) - GAP_X;
        const offsetX = (totalW - rowWidth) / 2;

        for (let col = 0; col < row.length; col++) {
          const idx = row[col];
          builtNodes[idx] = {
            x: offsetX + col * (NODE_W + GAP_X),
            y: PADDING + layer * (NODE_H + GAP_Y),
            scene: scenes[idx],
            index: idx,
          };
        }
      }

      // Build edges
      const builtEdges: { from: NodePosition; to: NodePosition; fromIdx: number; toIdx: number }[] =
        [];
      for (let i = 0; i < scenes.length; i++) {
        const target = scenes[i].causesScene;
        if (target && keyToIdx.has(target) && builtNodes[i] && builtNodes[keyToIdx.get(target)!]) {
          builtEdges.push({
            from: builtNodes[i],
            to: builtNodes[keyToIdx.get(target)!],
            fromIdx: i,
            toIdx: keyToIdx.get(target)!,
          });
        }
      }

      return { nodes: builtNodes, edges: builtEdges, width: totalW, height: totalH };
    }, [board.sceneBoards]);

    if (board.sceneBoards.length === 0) {
      return <div className={styles.emptyHint}>当前幕没有场景，请先在正文中标记"第X场"</div>;
    }

    return (
      <div className={styles.causalContainer} ref={canvasRef}>
        <div
          className={styles.causalCanvas}
          style={{ width: Math.max(width, 300), height: Math.max(height, 200) }}
        >
          {/* SVG edges */}
          <svg
            className={styles.causalEdges}
            width={Math.max(width, 300)}
            height={Math.max(height, 200)}
          >
            <defs>
              <marker
                id="causal-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 Z" fill="rgba(86, 156, 214, 0.6)" />
              </marker>
              <filter id="causal-glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W / 2;
              const y1 = edge.from.y + NODE_H;
              const x2 = edge.to.x + NODE_W / 2;
              const y2 = edge.to.y;
              const midY = (y1 + y2) / 2;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none"
                  stroke="rgba(86, 156, 214, 0.45)"
                  strokeWidth="2"
                  markerEnd="url(#causal-arrow)"
                  filter="url(#causal-glow)"
                  className={styles.causalEdgePath}
                />
              );
            })}
          </svg>

          {/* Scene nodes */}
          {nodes.map((node) => {
            if (!node) return null;
            const { scene, x, y, index } = node;
            const isActive = activeScene === scene.sceneKey;
            const intensityColor = INTENSITY_COLORS[Math.min(scene.intensity || 1, 5) - 1];

            return (
              <div
                key={scene.sceneKey}
                className={`${styles.causalNode} ${isActive ? styles.causalNodeActive : ''}`}
                style={{
                  left: x,
                  top: y,
                  width: NODE_W,
                  height: NODE_H,
                  borderLeftColor: intensityColor,
                }}
                onClick={() => onSceneClick(scene.sceneKey)}
              >
                <div className={styles.causalNodeHeader}>
                  <span className={styles.causalNodeIndex}>{index + 1}</span>
                  <span className={styles.causalNodeTitle}>{scene.title}</span>
                </div>
                {scene.objective && <div className={styles.causalNodeSub}>{scene.objective}</div>}
                <div className={styles.causalStatusBadge} data-status={scene.status} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
