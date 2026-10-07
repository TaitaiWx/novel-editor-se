/**
 * 3D 预演引擎的预设与纯函数入口：姿势在 poses.ts，机位在 camera.ts，道具与氛围在 scenery.ts。
 * 动画脚本（PrevizScript）、插值与默认脚本在 @novel-editor/video（previz.ts / previz-sample.ts）。
 * 渲染在 Previz/stage.ts（three.js，按需加载）。
 */
import { PREVIZ_FIGURE_COLORS } from '@novel-editor/video';

export * from './poses';
export * from './camera';
export * from './scenery';

/** 单个静态人物（只用于单帧摆姿势，例如测试木偶的姿势） */
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
export const FIGURE_COLORS: readonly string[] = PREVIZ_FIGURE_COLORS;

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
