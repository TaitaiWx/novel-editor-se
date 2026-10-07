import { describe, expect, it } from 'vitest';
import { SHOT_SIZES } from '@novel-editor/video';
import {
  GAIT_JOINTS,
  MIN_CAMERA_HEIGHT,
  MOODS,
  POSE_PRESETS,
  PROP_PRESETS,
  SHOT_FRAMING,
  cameraPlacement,
  captureSize,
  defaultCameraView,
  defaultFigures,
  defaultLensFor,
  frameRect,
  gaitJoints,
  lensFov,
  lightDirection,
  placementFromSample,
  moodById,
  poseById,
  propPreset,
  ratioOf,
  type PrevizCameraView,
} from '@/render/components/SceneVideoView/Previz/presets';

const LENSES = [24, 35, 50, 85];

const view = (patch: Partial<PrevizCameraView> = {}): PrevizCameraView => ({
  ...defaultCameraView('中景'),
  ...patch,
});

describe('Previz 姿势', () => {
  it('poseById：找到对应姿势，未知 id 回退站立；id 唯一', () => {
    expect(poseById('sit').label).toBe('坐');
    expect(poseById('fallen').drop).toBeGreaterThan(0);
    expect(poseById('不存在')).toBe(POSE_PRESETS[0]);
    expect(poseById('不存在').id).toBe('stand');
    expect(new Set(POSE_PRESETS.map((pose) => pose.id)).size).toBe(POSE_PRESETS.length);
    expect(new Set(POSE_PRESETS.map((pose) => pose.label)).size).toBe(POSE_PRESETS.length);
  });

  it('包含常用的新姿势：指向 / 跪地 / 回头 / 交谈 / 蹲下', () => {
    const labels = POSE_PRESETS.map((pose) => pose.label);
    for (const label of ['站立', '行走', '奔跑', '坐', '拔剑', '对峙', '拥抱', '倒地']) {
      expect(labels).toContain(label);
    }
    for (const label of ['指向', '跪地', '回头', '交谈', '蹲下']) expect(labels).toContain(label);
  });
});

describe('Previz 机位', () => {
  it('景别从远到近：相机越来越近；未知景别按中景', () => {
    const distances = SHOT_SIZES.map(
      (size) => cameraPlacement(view({ shotSize: size, lens: 50 })).distance
    );
    expect(distances).toEqual([...distances].sort((a, b) => b - a));
    expect(cameraPlacement(view({ shotSize: '奇怪的景别' }))).toEqual(cameraPlacement(view()));
  });

  it('焦距：越长视角越窄、相机越远（人物大小不变）', () => {
    const fovs = LENSES.map((lens) => lensFov(lens, 16 / 9));
    expect(fovs).toEqual([...fovs].sort((a, b) => b - a));
    const distances = LENSES.map((lens) => cameraPlacement(view({ lens })).distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    // 50mm 横画幅 16:9：竖直视角约 22.9°
    expect(lensFov(50, 16 / 9)).toBeCloseTo(22.9, 0);
    // 竖画幅以长边为高：视角比横画幅大
    expect(lensFov(50, 9 / 16)).toBeGreaterThan(lensFov(50, 16 / 9));
    // 画面竖直方向正好框住景别高度
    const placement = cameraPlacement(view({ lens: 35 }));
    const framed = 2 * placement.distance * Math.tan((placement.fov * Math.PI) / 360);
    expect(framed).toBeCloseTo(SHOT_FRAMING['中景'].height, 2);
  });

  it('defaultLensFor / defaultCameraView：景别对应常用焦距，未知景别按中景', () => {
    expect(defaultLensFor('远景')).toBe(24);
    expect(defaultLensFor('特写')).toBe(85);
    expect(defaultLensFor('??')).toBe(50);
    expect(defaultCameraView('??')).toMatchObject({ shotSize: '中景', angle: 'eye', yaw: 0 });
    expect(defaultCameraView('全景', { x: 1, z: -2 })).toMatchObject({ focusX: 1, focusZ: -2 });
  });

  it('角度：平视与注视点同高；俯视更高、仰视更低（不低于最低高度）', () => {
    const eye = cameraPlacement(view());
    expect(eye.position[1]).toBeCloseTo(eye.target[1]);
    expect(eye.position[0]).toBeCloseTo(0);
    expect(eye.position[2]).toBeCloseTo(eye.distance);
    expect(cameraPlacement(view({ angle: 'high' })).position[1]).toBeGreaterThan(eye.position[1]);
    expect(cameraPlacement(view({ angle: 'low' })).position[1]).toBeLessThan(eye.position[1]);
    for (const size of SHOT_SIZES) {
      const low = cameraPlacement(view({ shotSize: size, angle: 'low', pitch: -60 }));
      expect(low.position[1]).toBeGreaterThanOrEqual(MIN_CAMERA_HEIGHT);
    }
  });

  it('环绕 / 升降 / 对准点：绕注视点转动，升降同时移动相机与注视点', () => {
    const side = cameraPlacement(view({ yaw: 90, focusX: 1, focusZ: 2 }));
    expect(side.target).toEqual([1, SHOT_FRAMING['中景'].targetY, 2]);
    expect(side.position[0]).toBeCloseTo(1 + side.distance, 2);
    expect(side.position[2]).toBeCloseTo(2, 2);
    const back = cameraPlacement(view({ yaw: 180 }));
    expect(back.position[2]).toBeCloseTo(-back.distance, 2);
    const raised = cameraPlacement(view({ pedestal: 0.5 }));
    expect(raised.target[1]).toBeCloseTo(SHOT_FRAMING['中景'].targetY + 0.5);
    expect(raised.position[1]).toBeCloseTo(raised.target[1]);
    expect(cameraPlacement(view({ pitch: 30 })).position[1]).toBeGreaterThan(raised.target[1]);
  });

  it('placementFromSample 与 cameraPlacement 一致（预演脚本的机位采样）', () => {
    const base = cameraPlacement(view({ yaw: 30, pitch: 10, pedestal: 0.3, focusX: 1 }));
    const sampled = placementFromSample({
      framingHeight: SHOT_FRAMING['中景'].height,
      targetY: SHOT_FRAMING['中景'].targetY,
      lens: 50,
      elevation: 10,
      yaw: 30,
      height: 0.3,
      focusX: 1,
      focusZ: 0,
    });
    expect(sampled).toEqual(base);
  });

  it('ratioOf / frameRect / captureSize：取景框居中、比例正确；截图长边 1280', () => {
    expect(ratioOf('16:9')).toBeCloseTo(16 / 9);
    expect(ratioOf('9:16')).toBeCloseTo(9 / 16);
    expect(ratioOf('乱写')).toBeCloseTo(16 / 9);
    const wide = frameRect(1000, 600, 16 / 9);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    expect(wide.x * 2 + wide.width).toBeCloseTo(1000, -1);
    expect(wide.x).toBe(20);
    const tall = frameRect(1000, 600, 9 / 16);
    expect(tall.height).toBe(560);
    expect(tall.width).toBe(315);
    expect(tall.x).toBe(Math.round((1000 - 315) / 2));
    expect(captureSize(16 / 9)).toEqual({ width: 1280, height: 720 });
    expect(captureSize(9 / 16)).toEqual({ width: 720, height: 1280 });
    expect(captureSize(1)).toEqual({ width: 1280, height: 1280 });
    expect(captureSize(2.39).height % 2).toBe(0);
  });
});

describe('Previz 人物', () => {
  it('defaultFigures：沿 X 轴居中排开、间距 0.9，面向镜头；没有人物时给一个占位', () => {
    const three = defaultFigures(['林舟', '苏晴', '秦伯']);
    expect(three.map((figure) => figure.x)).toEqual([-0.9, 0, 0.9]);
    expect(three.map((figure) => figure.id)).toEqual(['f1', 'f2', 'f3']);
    expect(three.every((figure) => figure.z === 0 && figure.rotation === 0)).toBe(true);
    expect(three.every((figure) => figure.pose === 'stand')).toBe(true);
    expect(new Set(three.map((figure) => figure.color)).size).toBe(3);
    expect(defaultFigures(['a', 'b']).map((figure) => figure.x)).toEqual([-0.45, 0.45]);
    const placeholder = defaultFigures([]);
    expect(placeholder).toHaveLength(1);
    expect(placeholder[0]).toMatchObject({ name: '人物', x: 0 });
    const seven = defaultFigures(['1', '2', '3', '4', '5', '6', '7']);
    expect(seven[6].color).toBe(seven[0].color);
  });
});

describe('Previz 步态', () => {
  it('左腿向前时右臂向前（对侧摆臂），半个周期后反过来；只影响四肢', () => {
    const a = gaitJoints('walk', Math.PI / 2);
    expect(a.leftThigh?.[0]).toBeLessThan(0);
    expect(a.rightThigh?.[0]).toBeGreaterThan(0);
    expect(a.rightUpperArm?.[0]).toBeLessThan(0);
    const b = gaitJoints('walk', (Math.PI * 3) / 2);
    expect(b.leftThigh?.[0]).toBeGreaterThan(0);
    expect(Math.abs(gaitJoints('run', Math.PI / 2).leftThigh?.[0] ?? 0)).toBeGreaterThan(
      Math.abs(a.leftThigh?.[0] ?? 0)
    );
    expect(Object.keys(a).every((name) => (GAIT_JOINTS as readonly string[]).includes(name))).toBe(
      true
    );
  });
});

describe('Previz 场景', () => {
  it('道具：包含墙 / 门 / 桌子 / 树 / 柱子', () => {
    const labels = PROP_PRESETS.map((preset) => preset.label);
    for (const label of ['墙', '门', '桌子', '树', '柱子']) expect(labels).toContain(label);
    expect(propPreset('door').label).toBe('门');
  });

  it('时段：白天 / 黄昏 / 夜晚，主光方向是单位向量且在地平线以上', () => {
    expect(MOODS.map((mood) => mood.label)).toEqual(['白天', '黄昏', '夜晚']);
    expect(moodById('nope').id).toBe('day');
    for (const mood of MOODS) {
      const [x, y, z] = lightDirection(mood);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 2);
      expect(y).toBeGreaterThan(0);
    }
    // 黄昏的太阳更低
    expect(lightDirection(moodById('dusk'))[1]).toBeLessThan(lightDirection(moodById('day'))[1]);
  });
});
