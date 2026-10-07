/**
 * 3D 预演（摆拍）的预设与纯函数入口：人物站位；姿势在 poses.ts，机位在 camera.ts，道具与氛围在 scenery.ts。
 * 渲染在 Previz/stage.ts（three.js，按需加载）。
 *
 * 只管构图：站位、朝向、姿势和镜头远近 / 角度 / 焦距，截图后作为生成首帧图的构图参考，不导出动作视频。
 */

export * from './poses';
export * from './camera';
export * from './scenery';

export interface PrevizFigure {
  id: string;
  name: string;
  x: number;
  z: number;
  /** 朝向（弧度，0 = 面向镜头） */
  rotation: number;
  pose: string;
  /** 人物标识色（木偶会带一点这个颜色，名字标签用它做色点） */
  color: string;
  /** 头部左右转（度，正 = 向人物左侧），叠加在姿势之上 */
  headTurn?: number;
  /** 抬右手（度，0–170），叠加在姿势之上 */
  armRaise?: number;
}

/** 柔和的人物标识色 */
export const FIGURE_COLORS = ['#c9a27a', '#8fb3d9', '#a9c79a', '#d4a5c0', '#c7c08a', '#9fb0c9'];

/** 默认站位：人物沿 X 轴一字排开、面向镜头，间距 0.9 米 */
export function defaultFigures(names: readonly string[]): PrevizFigure[] {
  const list = names.length ? names : ['人物'];
  const spacing = 0.9;
  const start = (-(list.length - 1) * spacing) / 2;
  return list.map((name, index) => ({
    id: `f${index + 1}`,
    name,
    x: Math.round((start + index * spacing) * 100) / 100,
    z: 0,
    rotation: 0,
    pose: 'stand',
    color: FIGURE_COLORS[index % FIGURE_COLORS.length],
  }));
}

/** 新人物的 id：f1、f2…，只增不减 */
export function nextFigureId(figures: readonly { id: string }[]): string {
  const max = figures.reduce((acc, item) => {
    const match = /^f(\d+)$/.exec(item.id);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `f${max + 1}`;
}

/** 添加人物：放在现有人物右侧 0.9 米处（超出舞台则回到左侧），颜色取下一个没用过的 */
export function createFigure(name: string, existing: readonly PrevizFigure[]): PrevizFigure {
  const used = new Set(existing.map((figure) => figure.color));
  const color =
    FIGURE_COLORS.find((item) => !used.has(item)) ??
    FIGURE_COLORS[existing.length % FIGURE_COLORS.length];
  const right = existing.length ? Math.max(...existing.map((figure) => figure.x)) + 0.9 : 0;
  const left = existing.length ? Math.min(...existing.map((figure) => figure.x)) - 0.9 : 0;
  const x = right <= STAGE_LIMIT ? right : left;
  return {
    id: nextFigureId(existing),
    name,
    x: clampToStage(x),
    z: 0,
    rotation: 0,
    pose: 'stand',
    color,
  };
}

/** 地面范围（米）：拖动人物 / 道具时限制在这个范围内 */
export const STAGE_LIMIT = 8;

export function clampToStage(value: number): number {
  return Math.max(-STAGE_LIMIT, Math.min(STAGE_LIMIT, Math.round(value * 100) / 100));
}

/** 人物站位的中心（「重置视角」时相机对准这里） */
export function figuresCenter(figures: readonly { x: number; z: number }[]): {
  x: number;
  z: number;
} {
  if (!figures.length) return { x: 0, z: 0 };
  const sum = figures.reduce((acc, item) => ({ x: acc.x + item.x, z: acc.z + item.z }), {
    x: 0,
    z: 0,
  });
  const round = (value: number) => Math.round(value * 100) / 100 || 0;
  return { x: round(sum.x / figures.length), z: round(sum.z / figures.length) };
}

/** 弧度 ↔ 度（滑块用整数度） */
export const toDegrees = (radians: number) => Math.round((radians * 180) / Math.PI);
export const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** 朝向规范到 [-180, 180] 度后转回弧度（旋转按钮连续加减时不越界） */
export function normalizeRotation(radians: number): number {
  let degrees = toDegrees(radians) % 360;
  if (degrees > 180) degrees -= 360;
  if (degrees < -180) degrees += 360;
  return toRadians(degrees);
}
