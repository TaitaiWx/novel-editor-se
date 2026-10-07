/**
 * 场景视频画布：节点 + 连线，可平移 / 缩放 / 拖动节点（不依赖第三方画布库）
 *
 * - 平移：拖动空白处，或触控板 / 滚轮滚动
 * - 缩放：⌘ / Ctrl + 滚轮（以指针为中心）、触控板双指捏合，或右下角按钮；「适应画布」显示全部节点
 * - 节点：拖动节点空白处移动（松开后保存位置），单击选中（右侧检查器编辑），Esc 取消选中
 * 作者没有手动平移 / 缩放过时，节点数量或容器尺寸变化会自动「适应画布」。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VscAdd, VscRemove, VscScreenFull } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import {
  edgePath,
  fitViewport,
  zoomAround,
  type CanvasEdge,
  type CanvasNode,
  type CanvasViewport,
} from '../canvasLayout';
import type { CanvasPoint } from '../sceneVideoState';
import styles from './styles.module.scss';

export interface SceneCanvasProps {
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, point: CanvasPoint) => void;
  renderNode: (node: CanvasNode) => React.ReactNode;
  labelFor: (node: CanvasNode) => string;
}

const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.2;
/** 节点内这些元素上按下指针时不拖动节点（交给元素自己处理） */
const INTERACTIVE = 'button, input, textarea, select, video, a, label, [data-no-drag]';

type Gesture =
  | {
      kind: 'pan';
      pointerId: number;
      startX: number;
      startY: number;
      origin: CanvasViewport;
      moved: boolean;
    }
  | {
      kind: 'node';
      pointerId: number;
      id: string;
      startX: number;
      startY: number;
      origin: CanvasPoint;
      moved: boolean;
    };

const SceneCanvas: React.FC<SceneCanvasProps> = ({
  nodes,
  edges,
  selectedId,
  onSelect,
  onMoveNode,
  renderNode,
  labelFor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<CanvasViewport | null>(null);
  const viewportRef = useRef<CanvasViewport | null>(null);
  viewportRef.current = viewport;
  /** 作者手动平移 / 缩放过：之后不再自动适应 */
  const userAdjustedRef = useRef(false);
  const gestureRef = useRef<Gesture | null>(null);
  /** 拖动中的节点位置（松开前只改本地，不写入分镜） */
  const [dragPosition, setDragPosition] = useState<{ id: string; point: CanvasPoint } | null>(null);

  const placed = useMemo(
    () =>
      dragPosition
        ? nodes.map((node) =>
            node.id === dragPosition.id ? { ...node, ...dragPosition.point } : node
          )
        : nodes,
    [dragPosition, nodes]
  );
  const byId = useMemo(() => new Map(placed.map((node) => [node.id, node])), [placed]);
  const fitKey = nodes.map((node) => node.id).join(',');
  const nodesRef = useRef(placed);
  nodesRef.current = placed;

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setViewport(
      fitViewport(nodesRef.current, {
        width: rect.width || container.clientWidth,
        height: rect.height || container.clientHeight,
      })
    );
  }, []);

  // 首次显示与节点增减时自动适应（作者手动调整过视图后不再打扰）
  useLayoutEffect(() => {
    if (!userAdjustedRef.current || !viewportRef.current) fit();
  }, [fit, fitKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!userAdjustedRef.current) fit();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fit]);

  // 滚轮：平移；⌘ / Ctrl + 滚轮（含触控板捏合）：缩放。需要非 passive 监听才能阻止页面滚动
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      const current = viewportRef.current;
      if (!current) return;
      event.preventDefault();
      userAdjustedRef.current = true;
      if (event.ctrlKey || event.metaKey) {
        const rect = container.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * 0.0025);
        setViewport(
          zoomAround(current, current.zoom * factor, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          })
        );
        return;
      }
      setViewport({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const container = containerRef.current;
    const current = viewportRef.current;
    if (!container || !current) return;
    userAdjustedRef.current = true;
    const rect = container.getBoundingClientRect();
    setViewport(
      zoomAround(current, current.zoom * factor, { x: rect.width / 2, y: rect.height / 2 })
    );
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !viewportRef.current) return;
    const target = event.target as HTMLElement;
    const nodeElement = target.closest<HTMLElement>('[data-node-id]');
    if (nodeElement) {
      if (target.closest(INTERACTIVE)) return;
      const id = nodeElement.dataset.nodeId ?? '';
      const node = byId.get(id);
      if (!node) return;
      gestureRef.current = {
        kind: 'node',
        pointerId: event.pointerId,
        id,
        startX: event.clientX,
        startY: event.clientY,
        origin: { x: node.x, y: node.y },
        moved: false,
      };
    } else {
      gestureRef.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: viewportRef.current,
        moved: false,
      };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    gesture.moved = true;
    if (gesture.kind === 'pan') {
      userAdjustedRef.current = true;
      setViewport({ ...gesture.origin, x: gesture.origin.x + dx, y: gesture.origin.y + dy });
      return;
    }
    const zoom = viewportRef.current?.zoom ?? 1;
    setDragPosition({
      id: gesture.id,
      point: {
        x: Math.round(gesture.origin.x + dx / zoom),
        y: Math.round(gesture.origin.y + dy / zoom),
      },
    });
  };

  const finishGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (gesture.kind === 'pan') {
      if (!gesture.moved && !cancelled) onSelect(null);
      return;
    }
    if (gesture.moved && dragPosition && !cancelled) {
      onMoveNode(gesture.id, dragPosition.point);
    } else if (!gesture.moved && !cancelled) {
      onSelect(gesture.id);
    }
    setDragPosition(null);
  };

  const transform = viewport
    ? `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
    : undefined;

  return (
    <div className={styles.shell}>
      <div
        ref={containerRef}
        className={styles.canvas}
        data-testid="scene-canvas"
        role="application"
        aria-label="场景视频画布（拖动空白处平移，⌘ / Ctrl + 滚轮缩放，单击节点编辑）"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishGesture(event, false)}
        onPointerCancel={(event) => finishGesture(event, true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && selectedId) {
            event.stopPropagation();
            onSelect(null);
          }
        }}
      >
        <div
          className={styles.stage}
          style={{ transform, visibility: viewport ? 'visible' : 'hidden' }}
        >
          <svg className={styles.edges} aria-hidden="true">
            {edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to) return null;
              return (
                <path
                  key={edge.id}
                  d={edgePath(from, to)}
                  className={edge.dashed ? styles.edgeDashed : styles.edge}
                  data-edge={edge.id}
                />
              );
            })}
          </svg>
          {placed.map((node) => (
            <div
              key={node.id}
              className={`${styles.node} ${selectedId === node.id ? styles.nodeSelected : ''} ${
                dragPosition?.id === node.id ? styles.nodeDragging : ''
              }`}
              style={{ left: node.x, top: node.y, width: node.width }}
              data-node-id={node.id}
              data-node-kind={node.kind}
              role="group"
              aria-label={labelFor(node)}
              aria-current={selectedId === node.id ? 'true' : undefined}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (
                  (event.key === 'Enter' || event.key === ' ') &&
                  event.target === event.currentTarget
                ) {
                  event.preventDefault();
                  onSelect(node.id);
                }
              }}
            >
              {renderNode(node)}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.zoomBar} role="toolbar" aria-label="画布缩放">
        <Tooltip content="缩小（⌘ / Ctrl + 滚轮）">
          <button
            type="button"
            className={styles.zoomButton}
            aria-label="缩小"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            <VscRemove />
          </button>
        </Tooltip>
        <span className={styles.zoomValue} aria-live="polite">
          {Math.round((viewport?.zoom ?? 1) * 100)}%
        </span>
        <Tooltip content="放大（⌘ / Ctrl + 滚轮）">
          <button
            type="button"
            className={styles.zoomButton}
            aria-label="放大"
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <VscAdd />
          </button>
        </Tooltip>
        <Tooltip content="适应画布：显示全部节点">
          <button
            type="button"
            className={styles.zoomButton}
            aria-label="适应画布"
            onClick={() => {
              userAdjustedRef.current = false;
              fit();
            }}
          >
            <VscScreenFull />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default SceneCanvas;
