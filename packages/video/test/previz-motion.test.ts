import { describe, expect, it } from 'vitest';
import {
  PREVIZ_JOINT_RANGES,
  PREVIZ_MOTION_MAX_KEYS,
  PREVIZ_MOTION_MAX_TOTAL_KEYS,
  PREVIZ_SCRIPT_MAX_MOTION_KEYS,
  blendMotionPoses,
  motionDuration,
  quatFromEulerXYZ,
  sampleKeyValues,
  sampleMotionTracks,
  samplePrevizScript,
  validateMotionTracks,
  validatePrevizScript,
  type PrevizMotion,
  type PrevizScript,
} from '../src';

function scriptOf(motion: unknown, extraKeys: unknown[] = []) {
  const result = validatePrevizScript({
    durationSec: 4,
    figures: [{ name: 'A', keys: [{ t: 0, x: 0, z: 0, pose: 'stand', motion }, ...extraKeys] }],
    camera: [{ t: 0, shotSize: 'full' }],
  });
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result;
}

const angleOf = (q: readonly number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));

describe('预演动作：校验', () => {
  it('关节名大小写 / 连字符不敏感；对象关键帧；未知关节警告；时间排序去重', () => {
    const { script, warnings } = scriptOf({
      tracks: {
        right_upper_arm: [
          [0.8, 0, 0, -150],
          [0, 0, 0, -10],
          { t: 0.4, x: 0, y: 0, z: -100 },
          [0.4, 0, 0, -120],
        ],
        HEAD: [{ t: 0, rot: [10, 20, 0] }],
        tail: [[0, 1, 2, 3]],
      },
      weight: 0.6,
      loop: true,
    });
    const motion = script.figures[0].keys[0].motion;
    expect(motion?.tracks?.rightUpperArm).toEqual([
      [0, 0, 0, -10],
      [0.4, 0, 0, -120],
      [0.8, 0, 0, -150],
    ]);
    expect(motion?.tracks?.head).toEqual([[0, 10, 20, 0]]);
    expect(motion?.weight).toBe(0.6);
    expect(motion?.loop).toBe(true);
    expect(warnings.some((item) => item.includes('tail'))).toBe(true);
  });

  it('角度夹到关节范围、起伏 / 前倾夹值，并给出警告', () => {
    const { script, warnings } = scriptOf({
      tracks: { rightShin: [[0, -40, 30, 0]], leftUpperArm: [[0, -400, 0, 500]] },
      rootBob: [[0, -5]],
      lean: [[0, 200]],
    });
    const motion = script.figures[0].keys[0].motion as PrevizMotion;
    expect(motion.tracks?.rightShin).toEqual([[0, 0, 10, 0]]);
    expect(motion.tracks?.leftUpperArm).toEqual([[0, -180, 0, 180]]);
    expect(motion.rootBob).toEqual([[0, -0.9]]);
    expect(motion.lean).toEqual([[0, 90]]);
    expect(warnings.filter((item) => item.includes('夹值')).length).toBeGreaterThanOrEqual(3);
  });

  it('含 NaN / 非数字 / 无穷大的关键帧丢弃；全部无效时整个动作去掉', () => {
    const { script, warnings } = scriptOf({
      tracks: {
        head: [
          [0, 'NaN', 0, 0],
          [0.5, 10, null, 0],
          ['x', 1, 1, 1],
          [1, 5, 0, 0],
        ],
        chest: [[0, Infinity, 0, 0]],
      },
    });
    expect(script.figures[0].keys[0].motion?.tracks).toEqual({ head: [[1, 5, 0, 0]] });
    expect(warnings.some((item) => item.includes('无效'))).toBe(true);
    expect(
      scriptOf({ tracks: { head: [[0, 'NaN', 0, 0]] } }).script.figures[0].keys[0].motion
    ).toBe(undefined);
    // JSON 里的 NaN 只能以字符串出现；数字 NaN 同样拒绝
    expect(validateMotionTracks({ tracks: { head: [[0, Number.NaN, 0, 0]] } }).ok).toBe(false);
  });

  it('数量上限：每个关节 ≤ 120、每个动作 ≤ 600、整个脚本 ≤ 3000 个关键帧', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => [index * 0.01, 0, 0, 0]);
    const tracks = Object.fromEntries(
      Object.keys(PREVIZ_JOINT_RANGES).map((joint) => [joint, many(200)])
    );
    const { script, warnings } = scriptOf({ tracks });
    const motion = script.figures[0].keys[0].motion as PrevizMotion;
    const counts = Object.values(motion.tracks ?? {}).map((keys) => keys?.length ?? 0);
    expect(Math.max(...counts)).toBe(PREVIZ_MOTION_MAX_KEYS);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(PREVIZ_MOTION_MAX_TOTAL_KEYS);
    expect(warnings.some((item) => item.includes('太多'))).toBe(true);

    const keys = Array.from({ length: 24 }, (_, index) => ({
      t: index * 0.1,
      x: 0,
      z: 0,
      pose: 'stand',
      motion: { tracks },
    }));
    const big = validatePrevizScript({
      durationSec: 4,
      figures: [{ name: 'A', keys }],
      camera: [{ t: 0, shotSize: 'full' }],
    });
    if (!big.ok) throw new Error('应当通过');
    const total = big.script.figures[0].keys.reduce(
      (sum, key) =>
        sum +
        Object.values(key.motion?.tracks ?? {}).reduce((acc, list) => acc + (list?.length ?? 0), 0),
      0
    );
    expect(total).toBe(PREVIZ_SCRIPT_MAX_MOTION_KEYS);
  });

  it('旧版动作片段引用（clip / start / speed / 字符串）静默丢弃，回退到姿势；generate 保留', () => {
    const { script, warnings } = scriptOf({ clip: 'lib:wave-test', start: 1, speed: 2 }, [
      { t: 1, x: 0, z: 0, pose: 'point', motion: 'builtin:wave' },
      { t: 2, x: 0, z: 0, pose: 'stand', motion: { clip: 'builtin:nod', generate: '点头' } },
      { t: 3, x: 0, z: 0, pose: 'stand', clip: 'builtin:idle' },
    ]);
    const keys = script.figures[0].keys;
    expect(keys[0].motion).toBeUndefined();
    expect(keys[1].motion).toBeUndefined();
    expect(keys[1].pose).toBe('point');
    expect(keys[2].motion).toEqual({ generate: '点头' });
    expect(keys[3].motion).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(JSON.stringify(script)).not.toContain('clip');
    // 采样时只用姿势
    expect(samplePrevizScript(script, 0.5).figures[0].motion).toBeUndefined();
  });

  it('validateMotionTracks：接受外层包一层 motion；没有轨迹时报错', () => {
    const ok = validateMotionTracks({ motion: { tracks: { head: [[0, 5, 0, 0]] }, loop: true } });
    expect(ok.ok && ok.motion).toEqual({ tracks: { head: [[0, 5, 0, 0]] }, loop: true });
    expect(validateMotionTracks('wave').ok).toBe(false);
    expect(validateMotionTracks({ tracks: {} }).ok).toBe(false);
  });
});

describe('预演动作：采样', () => {
  it('Hermite 插值经过关键帧、两端保持；曲线连续平滑（相邻帧差值小且无突变）', () => {
    const keys = [
      [0, 0],
      [1, 100],
      [2, 0],
      [3, 50],
    ];
    expect(sampleKeyValues(keys, 1)[0]).toBeCloseTo(100, 6);
    expect(sampleKeyValues(keys, -1)[0]).toBe(0);
    expect(sampleKeyValues(keys, 9)[0]).toBe(50);
    const step = 1 / 120;
    let maxJump = 0;
    let maxAccel = 0;
    let previous = sampleKeyValues(keys, 0)[0];
    let previousDelta = 0;
    for (let t = step; t <= 3; t += step) {
      const value = sampleKeyValues(keys, t)[0];
      const delta = value - previous;
      maxJump = Math.max(maxJump, Math.abs(delta));
      if (t > step) maxAccel = Math.max(maxAccel, Math.abs(delta - previousDelta));
      previous = value;
      previousDelta = delta;
    }
    // 速度连续（C1）：每帧变化 ≤ 2 度，变化率的变化很小
    expect(maxJump).toBeLessThan(2);
    expect(maxAccel).toBeLessThan(0.1);
  });

  it('循环：按最长轨迹的时长循环，首尾连续', () => {
    const motion: PrevizMotion = {
      tracks: {
        rightUpperArm: [
          [0, 0, 0, -150],
          [0.4, 0, 0, -160],
          [0.8, 0, 0, -150],
        ],
      },
      loop: true,
    };
    expect(motionDuration(motion)).toBe(0.8);
    const a = sampleMotionTracks(motion, 0.2)?.joints.rightUpperArm;
    const b = sampleMotionTracks(motion, 1.0)?.joints.rightUpperArm;
    a?.forEach((value, index) => expect(value).toBeCloseTo(b?.[index] ?? NaN, 6));
    const end = sampleMotionTracks(motion, 0.7999)?.joints.rightUpperArm ?? [0, 0, 0, 1];
    const start = sampleMotionTracks(motion, 0.8)?.joints.rightUpperArm ?? [0, 0, 0, 1];
    end.forEach((value, index) => expect(value).toBeCloseTo(start[index], 3));
  });

  it('采样结果夹在关节范围内（Hermite 过冲也不会超出）', () => {
    const motion: PrevizMotion = {
      tracks: {
        rightShin: [
          [0, 0, 0, 0],
          [0.2, 150, 0, 0],
          [0.4, 150, 0, 0],
          [0.6, 0, 0, 0],
        ],
      },
    };
    const limit = quatFromEulerXYZ((150 * Math.PI) / 180, 0, 0);
    for (let t = 0; t <= 0.6; t += 0.01) {
      const q = sampleMotionTracks(motion, t)?.joints.rightShin ?? [0, 0, 0, 1];
      expect(angleOf(q)).toBeLessThanOrEqual(angleOf(limit) + 1e-6);
    }
  });

  it('lean / rootBob：髋部旋转与起伏', () => {
    const pose = sampleMotionTracks({ tracks: {}, lean: [[0, 30]], rootBob: [[0, -0.2]] }, 0);
    expect(pose?.rootY).toBeCloseTo(-0.2, 6);
    expect(angleOf(pose?.joints.hips ?? [0, 0, 0, 1])).toBeCloseTo((30 * Math.PI) / 180, 6);
    expect(sampleMotionTracks({ tracks: {} }, 0)).toBeNull();
  });

  it('混合：权重乘上 weight；交叉淡化时两侧都有的关节球面插值，只有一侧的淡入 / 淡出', () => {
    const a = sampleMotionTracks({ tracks: { head: [[0, 20, 0, 0]], chest: [[0, 10, 0, 0]] } }, 0);
    const b = sampleMotionTracks({ tracks: { head: [[0, -20, 0, 0]] }, rootBob: [[0, -0.1]] }, 0);
    const half = blendMotionPoses(a, b, 0.5, { from: 1, to: 0.5 });
    expect(half?.joints.head?.weight).toBeCloseTo(0.75, 6);
    expect(half?.joints.chest?.weight).toBeCloseTo(0.5, 6);
    expect(half?.rootY).toBeCloseTo(-0.025, 6);
    expect(blendMotionPoses(a, null, 0, { from: 0.4 })?.joints.head?.weight).toBeCloseTo(0.4, 6);
  });

  it('关键帧之间：从这一帧开始播放（时间相对这一段起点），到下一帧前交叉淡化到下一段的动作', () => {
    const script: PrevizScript = scriptOf(
      {
        tracks: {
          head: [
            [0, 0, 0, 0],
            [1, 0, 60, 0],
          ],
        },
      },
      [{ t: 2, x: 0, z: 0, pose: 'stand', motion: { tracks: { head: [[0, 0, -60, 0]] } } }]
    ).script;
    const at = (t: number) => samplePrevizScript(script, t).figures[0].motion?.joints.head;
    // 0.5 秒时头转到一半（约 30 度）
    expect(angleOf(at(0.5)?.q ?? [0, 0, 0, 1])).toBeCloseTo((30 * Math.PI) / 180, 1);
    expect(at(0.5)?.weight).toBe(1);
    // 淡化区间里转角在两段之间连续变化
    let previous = at(1.6)?.q ?? [0, 0, 0, 1];
    for (let t = 1.61; t < 2; t += 0.01) {
      const q = at(t)?.q ?? [0, 0, 0, 1];
      const dot = Math.abs(q.reduce((sum, value, index) => sum + value * previous[index], 0));
      expect(dot).toBeGreaterThan(0.99);
      previous = q;
    }
    // 第二段：头转到另一侧
    const second = at(2.5)?.q ?? [0, 0, 0, 1];
    expect(second[1]).toBeLessThan(0);
  });
});
