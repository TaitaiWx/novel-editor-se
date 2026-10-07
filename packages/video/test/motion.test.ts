import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MOTIONS,
  BvhParseError,
  blendMotionPoses,
  builtinMotionBvh,
  builtinMotionClips,
  createMotionLibrary,
  isMotionFileName,
  libraryClipId,
  libraryFileOfClip,
  matchSkeleton,
  motionClipFromBvh,
  motionClipTime,
  normalizeBoneName,
  parseBvh,
  quatFromEulerXYZ,
  quatToEulerXYZ,
  retargetBvh,
  sampleMotionClip,
  serializeBvh,
  vecRotate,
  type BvhJointSpec,
  type Quat,
} from '../src';

/** 3 帧：静止 / 左上臂 Zrotation -80 / 再加根关节下降 10 */
function frames(): string {
  const rows: number[][] = [];
  for (let f = 0; f < 3; f += 1) {
    const row = new Array<number>(42).fill(0);
    row[1] = f === 2 ? 80 : 90;
    if (f > 0) row[18] = -80;
    rows.push(row);
  }
  return rows.map((row) => row.join(' ')).join('\n');
}

/** 小型 Mixamo 式 T-pose 骨架（厘米）：手臂水平伸向两侧 */
const T_POSE = `HIERARCHY
ROOT mixamorig:Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT mixamorig:Spine
  {
    OFFSET 0 10 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT mixamorig:Spine2
    {
      OFFSET 0 30 0
      CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT mixamorig:Neck
      {
        OFFSET 0 20 0
        CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT mixamorig:Head
        {
          OFFSET 0 8 0
          CHANNELS 3 Zrotation Xrotation Yrotation
          End Site
          {
            OFFSET 0 18 0
          }
        }
      }
      JOINT mixamorig:LeftArm
      {
        OFFSET 18 18 0
        CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT mixamorig:LeftForeArm
        {
          OFFSET 28 0 0
          CHANNELS 3 Zrotation Xrotation Yrotation
          End Site
          {
            OFFSET 25 0 0
          }
        }
      }
      JOINT mixamorig:RightArm
      {
        OFFSET -18 18 0
        CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT mixamorig:RightForeArm
        {
          OFFSET -28 0 0
          CHANNELS 3 Zrotation Xrotation Yrotation
          End Site
          {
            OFFSET -25 0 0
          }
        }
      }
    }
  }
  JOINT mixamorig:LeftUpLeg
  {
    OFFSET 9 0 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT mixamorig:LeftLeg
    {
      OFFSET 0 -45 0
      CHANNELS 3 Zrotation Xrotation Yrotation
      End Site
      {
        OFFSET 0 -45 0
      }
    }
  }
  JOINT mixamorig:RightUpLeg
  {
    OFFSET -9 0 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT mixamorig:RightLeg
    {
      OFFSET 0 -45 0
      CHANNELS 3 Zrotation Xrotation Yrotation
      End Site
      {
        OFFSET 0 -45 0
      }
    }
  }
}
MOTION
Frames: 3
Frame Time: 0.5
${frames()}`;

const DOWN = [0, -1, 0] as const;
const close = (a: readonly number[], b: readonly number[], digits = 2) =>
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i], digits));

describe('BVH 解析', () => {
  it('读取层级、偏移、通道顺序与帧数据', () => {
    const data = parseBvh(T_POSE);
    expect(data.joints.map((joint) => joint.name)).toEqual([
      'mixamorig:Hips',
      'mixamorig:Spine',
      'mixamorig:Spine2',
      'mixamorig:Neck',
      'mixamorig:Head',
      'mixamorig:LeftArm',
      'mixamorig:LeftForeArm',
      'mixamorig:RightArm',
      'mixamorig:RightForeArm',
      'mixamorig:LeftUpLeg',
      'mixamorig:LeftLeg',
      'mixamorig:RightUpLeg',
      'mixamorig:RightLeg',
    ]);
    expect(data.channelCount).toBe(6 + 12 * 3);
    expect(data.joints[0].channels).toEqual([
      'Xposition',
      'Yposition',
      'Zposition',
      'Zrotation',
      'Xrotation',
      'Yrotation',
    ]);
    expect(data.joints[5]).toMatchObject({
      parent: 2,
      offset: [18, 18, 0],
      channelOffset: 6 + 4 * 3,
    });
    expect(data.joints[4].endSite).toEqual([0, 18, 0]);
    expect(data.joints[2].children).toEqual([3, 5, 7]);
    expect(data.frameTime).toBe(0.5);
    expect(data.frameCount).toBe(3);
    expect(data.frames[1][data.joints[5].channelOffset]).toBe(-80);
  });

  it('关节名带空格；文件被截断时只取完整帧', () => {
    const text = [
      'HIERARCHY',
      'ROOT Bip01 Pelvis',
      '{ OFFSET 0 0 0 CHANNELS 3 Zrotation Xrotation Yrotation',
      '  JOINT Bip01 L Thigh { OFFSET 1 0 0 CHANNELS 3 Zrotation Xrotation Yrotation',
      '    End Site { OFFSET 0 -1 0 } } }',
      'MOTION',
      'Frames: 3',
      'Frame Time: 0.0333333',
      '1 2 3 4 5 6',
      '7 8 9 10 11',
    ].join('\n');
    const data = parseBvh(text);
    expect(data.joints.map((joint) => joint.name)).toEqual(['Bip01 Pelvis', 'Bip01 L Thigh']);
    expect(data.frameCount).toBe(1);
    expect(data.frames[0]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('格式错误给出可读的错误', () => {
    expect(() => parseBvh('hello')).toThrow(BvhParseError);
    expect(() => parseBvh('HIERARCHY\nROOT A\n{ OFFSET 0 0 0 }\n')).toThrow(/MOTION/);
    expect(() =>
      parseBvh(
        'HIERARCHY ROOT A { OFFSET 0 0 0 CHANNELS 1 Wrotation } MOTION Frames: 1 Frame Time: 0.1 0'
      )
    ).toThrow(/未知通道/);
    expect(() =>
      parseBvh(
        'HIERARCHY ROOT A { OFFSET 0 0 0 CHANNELS 1 Xrotation } MOTION Frames: 1 Frame Time: 0'
      )
    ).toThrow(/Frame Time/);
  });

  it('serializeBvh 与 parseBvh 往返一致', () => {
    const root: BvhJointSpec = {
      name: 'Hips',
      offset: [0, 0, 0],
      channels: ['Yposition', 'Zrotation'],
      children: [{ name: 'Spine', offset: [0, 5, 0], channels: ['Xrotation'], endSite: [0, 3, 0] }],
    };
    const text = serializeBvh(root, 0.04, [
      { Hips: { Yposition: 90, Zrotation: 5 }, Spine: { Xrotation: -12.5 } },
      { Hips: { Yposition: 91 } },
    ]);
    const data = parseBvh(text);
    expect(data.frames).toEqual([
      [90, 5, -12.5],
      [91, 0, 0],
    ]);
    expect(data.joints[1].endSite).toEqual([0, 3, 0]);
  });
});

describe('重定向', () => {
  it('关节名规范化：去掉命名空间与 mixamorig / Bip01 前缀，只比较 ASCII 字母数字', () => {
    expect(normalizeBoneName('mixamorig:LeftForeArm')).toBe('leftforearm');
    expect(normalizeBoneName('mixamorig_RightUpLeg')).toBe('rightupleg');
    expect(normalizeBoneName('Bip01 L UpperArm')).toBe('lupperarm');
    expect(normalizeBoneName('LowerBack')).toBe('lowerback');
  });

  it('按 Mixamo / CMU / 3ds Max 命名找到木偶关节，可用自定义名字表覆盖', () => {
    const data = parseBvh(T_POSE);
    const match = matchSkeleton(data);
    expect(match).toMatchObject({
      hips: 0,
      spine: 1,
      chest: 2,
      neck: 3,
      head: 4,
      leftUpperArm: 5,
      leftForearm: 6,
      rightUpperArm: 7,
      rightForearm: 8,
      leftThigh: 9,
      leftShin: 10,
    });
    expect(match.leftHand).toBeUndefined();
    // 覆盖：把 Spine2 当作 spine（chest 退到下一个候选，没有了）
    const custom = matchSkeleton(data, { spine: ['mixamorig:Spine2'] });
    expect(custom.spine).toBe(2);
  });

  it('T-pose 骨架：第 0 帧手臂水平伸开；肩部旋转 -80 度后手臂下垂；根关节下降换算为米', () => {
    const clip = retargetBvh(parseBvh(T_POSE), { id: 'lib:t', name: 't' });
    expect(clip.mapped).toContain('leftUpperArm');
    expect(clip.durationSec).toBe(1);
    const armDirection = (frame: number) => {
      const pose = sampleMotionClip(clip, frame * 0.5);
      // 胸、腰没有转动：上臂的世界朝向 = 局部旋转
      return vecRotate(pose.joints.leftUpperArm as Quat, DOWN);
    };
    close(armDirection(0), [1, 0, 0]);
    // BVH 的 Zrotation -80：左臂从水平向下转 80 度
    const down = armDirection(1);
    expect(down[1]).toBeLessThan(-0.95);
    expect(down[0]).toBeGreaterThan(0.1);
    // 腿长 90 → 木偶 0.95 米：根关节下降 10 → 约 0.106 米
    expect(sampleMotionClip(clip, 1).rootY).toBeCloseTo((-10 * 0.95) / 90, 3);
    // 腿与躯干没有转动 → 单位四元数
    close(sampleMotionClip(clip, 0).joints.leftThigh as Quat, [0, 0, 0, 1]);
  });

  it('骨架朝向不同（面向 +X）时换算到木偶坐标', () => {
    // 同一个骨架整体绕 Y 转 90 度：左手在 -Z、面向 +X
    const rotated = T_POSE.replace(/OFFSET (-?\d+) (-?\d+) (-?\d+)/g, (_m, x, y, z) => {
      return `OFFSET ${Number(z)} ${y} ${-Number(x) || 0}`;
    });
    const clip = retargetBvh(parseBvh(rotated), { id: 'lib:r', name: 'r' });
    close(vecRotate(sampleMotionClip(clip, 0).joints.leftUpperArm as Quat, DOWN), [1, 0, 0]);
  });

  it('一个关节都对不上时报错', () => {
    const text =
      'HIERARCHY ROOT Foo { OFFSET 0 0 0 CHANNELS 3 Zrotation Xrotation Yrotation End Site { OFFSET 0 1 0 } } MOTION Frames: 1 Frame Time: 0.1 0 0 0';
    expect(() => retargetBvh(parseBvh(text), { id: 'x', name: 'x' })).toThrow(/对不上/);
  });
});

describe('片段采样与混合', () => {
  const clip = builtinMotionClips().get('builtin:wave');
  if (!clip) throw new Error('缺少内置挥手');

  it('起点 / 速度 / 循环换算本地时间', () => {
    expect(motionClipTime(clip, 1, {})).toBe(1);
    expect(motionClipTime(clip, 3, {})).toBe(clip.durationSec);
    expect(motionClipTime(clip, 3, { loop: true })).toBeCloseTo(1, 3);
    expect(motionClipTime(clip, 1, { speed: 2, start: 0.5, loop: true })).toBeCloseTo(0.5, 3);
  });

  it('帧间插值连续，循环时首尾衔接', () => {
    const a = sampleMotionClip(clip, 0.5).joints.rightForearm as Quat;
    const b = sampleMotionClip(clip, 0.5 + 1 / 120).joints.rightForearm as Quat;
    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    expect(dot).toBeGreaterThan(0.999);
    const start = sampleMotionClip(clip, 0, { loop: true }).joints.rightForearm as Quat;
    const end = sampleMotionClip(clip, clip.durationSec - 1e-4, { loop: true }).joints
      .rightForearm as Quat;
    close(start, end, 2);
  });

  it('内置骨架与木偶同构：挥手时右上臂举过肩（欧拉角与 poses.ts 约定一致）', () => {
    const upper = sampleMotionClip(clip, 0).joints.rightUpperArm as Quat;
    const direction = vecRotate(upper, DOWN);
    expect(direction[1]).toBeGreaterThan(0.5);
    expect(direction[0]).toBeLessThan(0);
    // 单轴角度往返
    const euler = quatToEulerXYZ(quatFromEulerXYZ(0.3, 0, 0));
    close(euler, [0.3, 0, 0], 5);
  });

  it('交叉淡化：缺少的关节按另一侧权重淡入淡出', () => {
    const wave = sampleMotionClip(clip, 0);
    const half = blendMotionPoses(wave, null, 0.25);
    expect(half?.joints.rightUpperArm?.weight).toBeCloseTo(0.75, 5);
    const both = blendMotionPoses(wave, wave, 0.5);
    expect(both?.joints.rightUpperArm?.weight).toBe(1);
    expect(blendMotionPoses(null, null, 0.5)).toBeNull();
  });

  it('内置动作都能生成并解析，跳起动作带髋部起伏', () => {
    expect(BUILTIN_MOTIONS.map((item) => item.id)).toEqual([
      'builtin:idle',
      'builtin:wave',
      'builtin:nod',
      'builtin:look-around',
      'builtin:bow',
      'builtin:jump',
    ]);
    for (const info of BUILTIN_MOTIONS) {
      const text = builtinMotionBvh(info.id) ?? '';
      expect(text.startsWith('HIERARCHY')).toBe(true);
      expect(text.length).toBeLessThan(40_000);
    }
    const jump = builtinMotionClips().get('builtin:jump');
    if (!jump) throw new Error('缺少跳起');
    expect(sampleMotionClip(jump, 0.35).rootY).toBeLessThan(-0.15);
    expect(sampleMotionClip(jump, 0.6).rootY).toBeGreaterThan(0.25);
  });
});

describe('作品动作库', () => {
  it('文件名校验与 id 互转（只按扩展名与路径分隔符）', () => {
    expect(isMotionFileName('wave-test.bvh')).toBe(true);
    expect(isMotionFileName('挥手.BVH')).toBe(true);
    expect(isMotionFileName('../a.bvh')).toBe(false);
    expect(isMotionFileName('a/b.bvh')).toBe(false);
    expect(isMotionFileName('.hidden.bvh')).toBe(false);
    expect(isMotionFileName('a.fbx')).toBe(false);
    expect(isMotionFileName('a\u0000.bvh')).toBe(false);
    expect(libraryClipId('wave-test.bvh')).toBe('lib:wave-test');
    expect(libraryFileOfClip('lib:wave-test')).toBe('wave-test.bvh');
    expect(libraryFileOfClip('builtin:wave')).toBeNull();
  });

  it('动作库 = 内置 + 文件，同 id 时文件优先', () => {
    const clip = motionClipFromBvh('t.bvh', T_POSE);
    expect(clip.id).toBe('lib:t');
    const library = createMotionLibrary([clip]);
    expect(library.get('lib:t')).toBe(clip);
    expect(library.has('builtin:idle')).toBe(true);
  });
});
