/**
 * 3D 预演的机位：景别（取景高度）+ 角度 + 焦距 + 环绕 / 升降，以及画幅、取景框与截图尺寸。纯函数，便于测试。
 * 景别取景表与角度仰角来自 @novel-editor/video 的 PREVIZ_FRAMING / PREVIZ_ANGLE_ELEVATION（与预演脚本同一份）。
 *
 * 景别按「画面竖直方向框住多高的人」定义，焦距决定视角，二者一起推出相机距离：
 * 换长焦时相机自动后退、人物大小不变，只有透视感（背景压缩）变化，和真实拍摄一致。
 */

import {
  PREVIZ_ANGLE_ELEVATION,
  PREVIZ_FRAMING,
  PREVIZ_SHOT_SIZES,
  SHOT_SIZES,
  type PrevizAngle,
  type PrevizCameraSample,
} from '@novel-editor/video';

export type CameraAngle = PrevizAngle;

export interface ShotFraming {
  /** 画面竖直方向框住的高度（米） */
  height: number;
  /** 注视点高度（米） */
  targetY: number;
  /** 默认焦距（毫米） */
  lens: number;
}

/** 景别（从远到近），名称与分镜的景别一致（按顺序对应预演景别 id） */
export const SHOT_FRAMING: Record<string, ShotFraming> = Object.fromEntries(
  SHOT_SIZES.map((name, index) => [name, PREVIZ_FRAMING[PREVIZ_SHOT_SIZES[index]]])
);

const DEFAULT_SHOT_SIZE = SHOT_SIZES[3];

export function defaultLensFor(shotSize: string): number {
  return (SHOT_FRAMING[shotSize] ?? SHOT_FRAMING[DEFAULT_SHOT_SIZE]).lens;
}

export interface PrevizCameraView {
  shotSize: string;
  angle: CameraAngle;
  /** 焦距（毫米，全画幅等效，长边 36mm） */
  lens: number;
  /** 环绕角（度，0 = 正面，正 = 相机绕到人物左侧） */
  yaw: number;
  /** 在角度之上的额外仰角（度，拖动画面调整） */
  pitch: number;
  /** 机位升降（米，相机与注视点一起上下移） */
  pedestal: number;
  /** 注视的地面点（米） */
  focusX: number;
  focusZ: number;
}

export function defaultCameraView(
  shotSize: string,
  focus: { x: number; z: number } = { x: 0, z: 0 }
): PrevizCameraView {
  const size = SHOT_FRAMING[shotSize] ? shotSize : DEFAULT_SHOT_SIZE;
  return {
    shotSize: size,
    angle: 'eye',
    lens: defaultLensFor(size),
    yaw: 0,
    pitch: 0,
    pedestal: 0,
    focusX: focus.x,
    focusZ: focus.z,
  };
}

/** 画幅比例 "16:9" → 1.777…；无法解析时按 16:9 */
export function ratioOf(aspectRatio: string): number {
  const [w, h] = aspectRatio.split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** 焦距 → 画面竖直视角（度）。传感器长边固定 36mm（横画幅为宽、竖画幅为高） */
export function lensFov(lens: number, aspect: number): number {
  const sensorHeight = aspect >= 1 ? 36 / aspect : 36;
  return (2 * Math.atan(sensorHeight / (2 * Math.max(8, lens))) * 180) / Math.PI;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** 相机最低高度（米），仰拍时不钻到地面以下 */
export const MIN_CAMERA_HEIGHT = 0.12;

export interface CameraPlacement {
  position: [number, number, number];
  target: [number, number, number];
  /** 画面（截图）竖直视角（度） */
  fov: number;
  distance: number;
}

/** 机位 → 相机位置与注视点；aspect 为画幅宽高比 */
export function cameraPlacement(view: PrevizCameraView, aspect = 16 / 9): CameraPlacement {
  const framing = SHOT_FRAMING[view.shotSize] ?? SHOT_FRAMING[DEFAULT_SHOT_SIZE];
  return placementFromSample(
    {
      framingHeight: framing.height,
      targetY: framing.targetY,
      lens: view.lens,
      elevation: PREVIZ_ANGLE_ELEVATION[view.angle] + view.pitch,
      yaw: view.yaw,
      height: view.pedestal,
      focusX: view.focusX,
      focusZ: view.focusZ,
    },
    aspect
  );
}

/**
 * 预演脚本插值出的机位（samplePrevizScript 的 camera）→ 相机位置与注视点。
 * 景别高度与焦距一起决定距离：换长焦时相机后退、人物大小不变。
 */
export function placementFromSample(camera: PrevizCameraSample, aspect = 16 / 9): CameraPlacement {
  const fov = lensFov(camera.lens, aspect);
  const halfFov = (fov * Math.PI) / 360;
  const distance = clamp(camera.framingHeight / 2 / Math.tan(halfFov), 0.4, 150);
  const elevation = (clamp(camera.elevation, -40, 80) * Math.PI) / 180;
  const yaw = (camera.yaw * Math.PI) / 180;
  const targetY = Math.max(0.05, camera.targetY + camera.height);
  const target: [number, number, number] = [camera.focusX, targetY, camera.focusZ];
  const horizontal = Math.cos(elevation) * distance;
  const position: [number, number, number] = [
    round(camera.focusX + Math.sin(yaw) * horizontal),
    round(Math.max(MIN_CAMERA_HEIGHT, targetY + Math.sin(elevation) * distance)),
    round(camera.focusZ + Math.cos(yaw) * horizontal),
  ];
  const override = camera.override;
  if (!override || !(override.weight > 0)) return { position, target, fov, distance };
  // 绝对机位（预演脚本给了 position / target）：按权重从景别推算的机位过渡过去
  const w = Math.min(1, override.weight);
  const mix = (a: readonly number[], b: readonly number[]): [number, number, number] => [
    round(a[0] + (b[0] - a[0]) * w),
    round(a[1] + (b[1] - a[1]) * w),
    round(a[2] + (b[2] - a[2]) * w),
  ];
  const finalPosition = mix(position, override.position);
  finalPosition[1] = Math.max(MIN_CAMERA_HEIGHT, finalPosition[1]);
  const finalTarget = mix(target, override.target);
  const finalDistance = Math.hypot(
    finalPosition[0] - finalTarget[0],
    finalPosition[1] - finalTarget[1],
    finalPosition[2] - finalTarget[2]
  );
  return { position: finalPosition, target: finalTarget, fov, distance: finalDistance };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 视口里按画幅居中放下的取景框（四周留 margin 像素，框外是遮罩，看得到画外的环境） */
export function frameRect(
  viewWidth: number,
  viewHeight: number,
  aspect: number,
  margin = 20
): FrameRect {
  const availableW = Math.max(1, viewWidth - margin * 2);
  const availableH = Math.max(1, viewHeight - margin * 2);
  let width = availableW;
  let height = width / aspect;
  if (height > availableH) {
    height = availableH;
    width = height * aspect;
  }
  return {
    x: Math.round((viewWidth - width) / 2),
    y: Math.round((viewHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** 截图尺寸：长边 1280，按画幅比例，取偶数 */
export function captureSize(aspect: number, longEdge = 1280): { width: number; height: number } {
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return aspect >= 1
    ? { width: even(longEdge), height: even(longEdge / aspect) }
    : { width: even(longEdge * aspect), height: even(longEdge) };
}
