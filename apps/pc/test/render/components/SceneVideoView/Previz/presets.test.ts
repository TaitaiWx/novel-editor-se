import { describe, expect, it } from 'vitest';
import {
  POSE_PRESETS,
  SHOT_CAMERA,
  STAGE_LIMIT,
  cameraPlacement,
  clampToStage,
  defaultFigures,
  poseById,
} from '@/render/components/SceneVideoView/Previz/presets';

describe('Previz 预设', () => {
  it('poseById：找到对应姿势，未知 id 回退站立', () => {
    expect(poseById('sit').label).toBe('坐');
    expect(poseById('fallen').drop).toBeGreaterThan(0);
    expect(poseById('不存在')).toBe(POSE_PRESETS[0]);
    expect(poseById('不存在').id).toBe('stand');
    expect(new Set(POSE_PRESETS.map((pose) => pose.id)).size).toBe(POSE_PRESETS.length);
  });

  it('cameraPlacement：景别越近相机越近、视角越窄；未知景别按中景', () => {
    const order = ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'];
    const distances = order.map((size) => cameraPlacement(size, 'eye').position[2]);
    expect(distances).toEqual([...distances].sort((a, b) => b - a));
    const fovs = order.map((size) => cameraPlacement(size, 'eye').fov);
    expect(fovs).toEqual([...fovs].sort((a, b) => b - a));
    expect(cameraPlacement('奇怪的景别', 'eye')).toEqual(cameraPlacement('中景', 'eye'));
  });

  it('cameraPlacement：平视高度等于预设；俯视抬高、仰视降低（不低于 0.15）；注视点在 0.9–1.6', () => {
    const preset = SHOT_CAMERA['中景'];
    const eye = cameraPlacement('中景', 'eye');
    expect(eye.position).toEqual([0, preset.height, preset.distance]);
    expect(eye.target).toEqual([0, 1.45, 0]);
    const high = cameraPlacement('中景', 'high');
    expect(high.position[1]).toBeCloseTo(preset.height + preset.distance * 0.55);
    const low = cameraPlacement('中景', 'low');
    expect(low.position[1]).toBeCloseTo(Math.max(0.15, preset.height * 0.25));
    expect(low.position[1]).toBeLessThan(eye.position[1]);
    // 大远景的注视点被限制在 1.6，特写不低于 0.9
    expect(cameraPlacement('大远景', 'eye').target[1]).toBe(1.6);
    for (const size of Object.keys(SHOT_CAMERA)) {
      const y = cameraPlacement(size, 'low').position[1];
      expect(y).toBeGreaterThanOrEqual(0.15);
    }
  });

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
    // 颜色循环使用
    const seven = defaultFigures(['1', '2', '3', '4', '5', '6', '7']);
    expect(seven[6].color).toBe(seven[0].color);
  });

  it('clampToStage：限制在地面范围内并保留两位小数', () => {
    expect(clampToStage(100)).toBe(STAGE_LIMIT);
    expect(clampToStage(-100)).toBe(-STAGE_LIMIT);
    expect(clampToStage(1.23456)).toBe(1.23);
    expect(clampToStage(-0.005)).toBeCloseTo(0);
  });
});
