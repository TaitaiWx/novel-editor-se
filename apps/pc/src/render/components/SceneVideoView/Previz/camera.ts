/**
 * 3D 预演的机位：景别（取景高度）+ 角度 + 焦距 + 环绕 / 升降，以及画幅、取景框与截图尺寸。纯函数，便于测试。
 *
 * 景别按「画面竖直方向框住多高的人」定义，焦距决定视角，二者一起推出相机距离：
 * 换长焦时相机自动后退、人物大小不变，只有透视感（背景压缩）变化，和真实拍摄一致。
 */

export type CameraAngle = 'eye' | 'high' | 'low';

export const CAMERA_ANGLES: ReadonlyArray<{ id: CameraAngle; label: string }> = [
  { id: 'eye', label: '平视' },
  { id: 'high', label: '俯视' },
  { id: 'low', label: '仰视' },
];

/** 各角度的基础仰角（度，正 = 相机在上方往下拍） */
const ANGLE_ELEVATION: Record<CameraAngle, number> = { eye: 0, high: 32, low: -22 };

export interface ShotFraming {
  /** 画面竖直方向框住的高度（米） */
  height: number;
  /** 注视点高度（米） */
  targetY: number;
  /** 默认焦距（毫米） */
  lens: number;
}

/** 景别（从远到近），名称与分镜的景别一致 */
export const SHOT_FRAMING: Record<string, ShotFraming> = {
  大远景: { height: 30, targetY: 1.2, lens: 24 },
  远景: { height: 9, targetY: 1.1, lens: 24 },
  全景: { height: 2.3, targetY: 0.92, lens: 35 },
  中景: { height: 1.0, targetY: 1.33, lens: 50 },
  近景: { height: 0.7, targetY: 1.5, lens: 50 },
  特写: { height: 0.42, targetY: 1.62, lens: 85 },
  大特写: { height: 0.2, targetY: 1.67, lens: 85 },
};

export const SHOT_SIZES = Object.keys(SHOT_FRAMING);

export const LENSES: readonly number[] = [24, 35, 50, 85];

export function defaultLensFor(shotSize: string): number {
  return (SHOT_FRAMING[shotSize] ?? SHOT_FRAMING['中景']).lens;
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
  const size = SHOT_FRAMING[shotSize] ? shotSize : '中景';
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
  const framing = SHOT_FRAMING[view.shotSize] ?? SHOT_FRAMING['中景'];
  const fov = lensFov(view.lens, aspect);
  const halfFov = (fov * Math.PI) / 360;
  const distance = clamp(framing.height / 2 / Math.tan(halfFov), 0.4, 150);
  const elevation = (clamp(ANGLE_ELEVATION[view.angle] + view.pitch, -40, 80) * Math.PI) / 180;
  const yaw = (view.yaw * Math.PI) / 180;
  const targetY = Math.max(0.05, framing.targetY + view.pedestal);
  const target: [number, number, number] = [view.focusX, targetY, view.focusZ];
  const horizontal = Math.cos(elevation) * distance;
  const position: [number, number, number] = [
    round(view.focusX + Math.sin(yaw) * horizontal),
    round(Math.max(MIN_CAMERA_HEIGHT, targetY + Math.sin(elevation) * distance)),
    round(view.focusZ + Math.cos(yaw) * horizontal),
  ];
  return { position, target, fov, distance };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** 环绕角规范到 (-180, 180] */
export function normalizeYaw(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return Math.round(value * 10) / 10;
}

export function clampPitch(degrees: number): number {
  return clamp(Math.round(degrees * 10) / 10, -50, 60);
}

export const PEDESTAL_LIMIT = 2;

export function clampPedestal(meters: number): number {
  return clamp(Math.round(meters * 100) / 100, -PEDESTAL_LIMIT, PEDESTAL_LIMIT);
}

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
