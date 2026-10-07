/**
 * 拖动人物的位移换算（纯函数）：屏幕像素位移 → 地面位移（米）。
 *
 * 旧实现用「鼠标射线与地面（y = 0）的交点」移动人物：预演默认是平视机位（相机高 ≈ 注视点高，几乎水平），
 * 点在人物身上时射线与地面接近平行，交点在几十甚至几百米外；按下时记下的偏移量巨大，
 * 鼠标再动一两个像素交点就跳出几十米，人物被夹到舞台边缘（±8 米）、飞出画面找不回来。
 *
 * 现在改为按人物所在深度换算：
 * - 左右拖动：沿相机的右方向移动，每像素 = 人物深度处画面一个像素对应的米数（与画面同步，跟手）
 * - 上下拖动：沿相机前方（投影到地面）推远 / 拉近，按俯仰角放大，但平视时用下限避免除以 0
 * - 位移有上限，结果再夹在舞台内；按下后移动不足几个像素视为单击，不改变站位
 */
import { PREVIZ_STAGE_LIMIT } from '@novel-editor/video';

/** 小于这个距离（像素）的移动视为单击 */
export const DRAG_THRESHOLD_PX = 4;
/** 平视时上下拖动的放大系数下限（sin 仰角） */
const MIN_ELEVATION_SIN = 0.35;

export interface DragBasis {
  /** 相机环绕角（度） */
  yaw: number;
  /** 相机总仰角（度，正 = 从上往下拍） */
  elevation: number;
  /** 人物到相机的深度（米，沿视线方向） */
  depth: number;
  /** 取景框的竖直视角（度） */
  fov: number;
  /** 取景框高度（CSS 像素） */
  frameHeight: number;
}

/** 屏幕位移（像素，向右 / 向下为正）→ 地面位移（米） */
export function dragDeltaOnGround(
  basis: DragBasis,
  dxPx: number,
  dyPx: number
): { dx: number; dz: number } {
  if (Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return { dx: 0, dz: 0 };
  const depth = Math.max(0.5, Number.isFinite(basis.depth) ? basis.depth : 0.5);
  const frameHeight = Math.max(1, basis.frameHeight);
  const metersPerPx = (2 * depth * Math.tan((basis.fov * Math.PI) / 360)) / frameHeight;
  const yaw = (basis.yaw * Math.PI) / 180;
  const elevationSin = Math.abs(Math.sin((basis.elevation * Math.PI) / 180));
  const right = dxPx * metersPerPx;
  // 向上拖（dy < 0）= 推远
  const away = (-dyPx * metersPerPx) / Math.max(MIN_ELEVATION_SIN, elevationSin);
  // 相机右方向 (cos yaw, -sin yaw)；远离相机方向 (-sin yaw, -cos yaw)
  let dx = right * Math.cos(yaw) - away * Math.sin(yaw);
  let dz = -right * Math.sin(yaw) - away * Math.cos(yaw);
  const length = Math.hypot(dx, dz);
  const limit = PREVIZ_STAGE_LIMIT * 2;
  if (length > limit) {
    dx = (dx / length) * limit;
    dz = (dz / length) * limit;
  }
  return { dx, dz };
}

/** 人物位置到相机的深度（沿视线方向，米） */
export function depthAlongView(
  camera: {
    position: readonly [number, number, number];
    target: readonly [number, number, number];
  },
  point: { x: number; y: number; z: number }
): number {
  const [cx, cy, cz] = camera.position;
  const [tx, ty, tz] = camera.target;
  const fx = tx - cx;
  const fy = ty - cy;
  const fz = tz - cz;
  const length = Math.hypot(fx, fy, fz) || 1;
  return ((point.x - cx) * fx + (point.y - cy) * fy + (point.z - cz) * fz) / length;
}

/** 拖动空白处环绕机位：每像素转多少度 */
export const ORBIT_DEG_PER_PX = 0.3;
