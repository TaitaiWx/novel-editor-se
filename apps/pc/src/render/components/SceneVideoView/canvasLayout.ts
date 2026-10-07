/**
 * 场景视频画布的节点与连线（纯函数）
 *
 * 从左到右的流程：人物（参考形象）→ 场景（正文 / 地点）→ 镜头 1 → 镜头 2 → … → 样片。
 * 节点默认自动排布（镜头每行最多 SHOTS_PER_ROW 个，换行继续；样片在最后一个镜头右侧），作者拖动过的节点使用保存的位置。
 * 连线的端口固定在节点标题行的高度（PORT_OFFSET_Y），不依赖节点实际高度，避免测量 DOM。
 */
import type { Shot } from '@novel-editor/video';
import type { CanvasPoint, SceneCanvasState } from './sceneVideoState';

export type CanvasNodeKind = 'character' | 'scene' | 'shot' | 'output';

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  x: number;
  y: number;
  width: number;
  /** 估算高度（用于「适应画布」，不影响渲染） */
  height: number;
  /** 镜头在分镜中的位置（0-based） */
  index?: number;
  name?: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  /** 参考关系（人物 → 场景）用虚线 */
  dashed: boolean;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export const NODE_WIDTH: Record<CanvasNodeKind, number> = {
  character: 176,
  scene: 300,
  shot: 248,
  output: 272,
};

const NODE_HEIGHT: Record<CanvasNodeKind, number> = {
  character: 48,
  scene: 240,
  shot: 250,
  output: 230,
};

export const PORT_OFFSET_Y = 22;
export const SCENE_NODE_ID = 'scene';
export const OUTPUT_NODE_ID = 'output';
export const SHOTS_PER_ROW = 4;
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 1.6;
/** 自动适应时的最小缩放：再小文字就看不清了，内容放不下时改为从左上角开始显示，可平移查看 */
export const FIT_ZOOM_MIN = 0.72;

const COLUMN_GAP = 64;
const ROW_GAP = 48;
const CHARACTER_GAP = 14;

export function characterNodeId(name: string): string {
  return `character:${name}`;
}

export interface CanvasLayoutInput {
  characters: readonly string[];
  shots: readonly Shot[];
  canvas: SceneCanvasState;
}

export function layoutSceneCanvas(input: CanvasLayoutInput): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
} {
  const saved = input.canvas.positions;
  const place = (id: string, auto: CanvasPoint): CanvasPoint => saved[id] ?? auto;
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  const hasCharacters = input.characters.length > 0;
  const sceneX = hasCharacters ? NODE_WIDTH.character + COLUMN_GAP : 0;
  const shotsX = sceneX + NODE_WIDTH.scene + COLUMN_GAP;

  input.characters.forEach((name, index) => {
    const id = characterNodeId(name);
    const point = place(id, { x: 0, y: index * (NODE_HEIGHT.character + CHARACTER_GAP) });
    nodes.push({
      id,
      kind: 'character',
      ...point,
      width: NODE_WIDTH.character,
      height: NODE_HEIGHT.character,
      name,
    });
    edges.push({ id: `${id}->${SCENE_NODE_ID}`, from: id, to: SCENE_NODE_ID, dashed: true });
  });

  const scenePoint = place(SCENE_NODE_ID, { x: sceneX, y: 0 });
  nodes.push({
    id: SCENE_NODE_ID,
    kind: 'scene',
    ...scenePoint,
    width: NODE_WIDTH.scene,
    height: NODE_HEIGHT.scene,
  });

  // 镜头与样片按顺序排成网格：样片紧跟在最后一个镜头之后
  const flowSlot = (slot: number): CanvasPoint => ({
    x: shotsX + (slot % SHOTS_PER_ROW) * (NODE_WIDTH.shot + COLUMN_GAP),
    y: Math.floor(slot / SHOTS_PER_ROW) * (NODE_HEIGHT.shot + ROW_GAP),
  });
  let previous = SCENE_NODE_ID;
  input.shots.forEach((shot, index) => {
    const point = place(shot.id, flowSlot(index));
    nodes.push({
      id: shot.id,
      kind: 'shot',
      ...point,
      width: NODE_WIDTH.shot,
      height: NODE_HEIGHT.shot,
      index,
    });
    edges.push({ id: `${previous}->${shot.id}`, from: previous, to: shot.id, dashed: false });
    previous = shot.id;
  });
  // 样片紧跟在最后一个镜头右侧（同一行），连线不会斜穿画布
  const lastSlot = input.shots.length - 1;
  const outputAuto =
    lastSlot < 0
      ? { x: shotsX, y: 0 }
      : {
          x: flowSlot(lastSlot).x + NODE_WIDTH.shot + COLUMN_GAP,
          y: flowSlot(lastSlot).y,
        };
  const outputPoint = place(OUTPUT_NODE_ID, outputAuto);
  nodes.push({
    id: OUTPUT_NODE_ID,
    kind: 'output',
    ...outputPoint,
    width: NODE_WIDTH.output,
    height: NODE_HEIGHT.output,
  });
  if (input.shots.length > 0) {
    edges.push({
      id: `${previous}->${OUTPUT_NODE_ID}`,
      from: previous,
      to: OUTPUT_NODE_ID,
      dashed: false,
    });
  }
  return { nodes, edges };
}

/** 连线路径：从上游节点右侧端口到下游节点左侧端口的三次贝塞尔曲线 */
export function edgePath(from: CanvasNode, to: CanvasNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + PORT_OFFSET_Y;
  const x2 = to.x;
  const y2 = to.y + PORT_OFFSET_Y;
  const bend = Math.max(40, Math.min(160, Math.abs(x2 - x1) / 2 + Math.abs(y2 - y1) / 4));
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** 「适应画布」：让全部节点完整显示并居中（不放大超过 100%，不缩小到看不清） */
export function fitViewport(
  nodes: readonly CanvasNode[],
  size: { width: number; height: number },
  padding = 48
): CanvasViewport {
  if (nodes.length === 0 || size.width <= 0 || size.height <= 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const zoom = Math.max(
    FIT_ZOOM_MIN,
    clampZoom(Math.min(1, (size.width - padding * 2) / width, (size.height - padding * 2) / height))
  );
  // 放得下时居中，放不下时贴左 / 贴上（从流程起点开始看）
  const offset = (available: number, content: number, min: number) =>
    content * zoom <= available - padding * 2
      ? Math.round((available - content * zoom) / 2 - min * zoom)
      : Math.round(padding - min * zoom);
  return {
    zoom,
    x: offset(size.width, width, minX),
    y: offset(size.height, height, minY),
  };
}

/** 以屏幕上的某点为中心缩放（滚轮 / 按钮），该点下的画布内容保持不动 */
export function zoomAround(
  viewport: CanvasViewport,
  nextZoom: number,
  anchor: { x: number; y: number }
): CanvasViewport {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / viewport.zoom;
  return {
    zoom,
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
  };
}
