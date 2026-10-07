/**
 * 内置动作片段：用代码生成的小段 BVH（不随包分发大文件），走与外部 BVH 完全相同的解析 + 重定向流程。
 *
 * 骨架与木偶同构（Y 向上、面向 +Z、手臂下垂，CMU / Mixamo 式命名），角度约定与 poses.ts 一致：
 * 绕 X 为负 = 肢体向前抬；左臂 / 左腿绕 Z 为正 = 向外展开，右侧为负；头 / 胸绕 Y 为正 = 向人物左侧转。
 */
import { parseBvh, serializeBvh, type BvhChannel, type BvhJointSpec } from './bvh';
import { MANNEQUIN_HIP_HEIGHT, retargetBvh, type MotionClip, type MotionJoint } from './retarget';

const ROT: BvhChannel[] = ['Zrotation', 'Xrotation', 'Yrotation'];
const ROOT: BvhChannel[] = ['Xposition', 'Yposition', 'Zposition', ...ROT];

const limb = (
  names: [string, string, string],
  offset: [number, number, number],
  lengths: [number, number],
  end: [number, number, number]
): BvhJointSpec => ({
  name: names[0],
  offset,
  channels: ROT,
  children: [
    {
      name: names[1],
      offset: [0, -lengths[0], 0],
      channels: ROT,
      children: [{ name: names[2], offset: [0, -lengths[1], 0], channels: ROT, endSite: end }],
    },
  ],
});

/** 内置骨架（厘米）：腿长 89 */
const LEG_LENGTH = 89;
const SKELETON: BvhJointSpec = {
  name: 'Hips',
  offset: [0, 0, 0],
  channels: ROOT,
  children: [
    {
      name: 'Spine',
      offset: [0, 10, 0],
      channels: ROT,
      children: [
        {
          name: 'Spine1',
          offset: [0, 16, 0],
          channels: ROT,
          children: [
            {
              name: 'Neck',
              offset: [0, 28, 0],
              channels: ROT,
              children: [{ name: 'Head', offset: [0, 7, 0], channels: ROT, endSite: [0, 20, 0] }],
            },
            limb(['LeftArm', 'LeftForeArm', 'LeftHand'], [20, 22, 0], [29, 26], [0, -15, 0]),
            limb(['RightArm', 'RightForeArm', 'RightHand'], [-20, 22, 0], [29, 26], [0, -15, 0]),
          ],
        },
      ],
    },
    limb(['LeftUpLeg', 'LeftLeg', 'LeftFoot'], [9, -2, 0], [44, 43], [0, 0, 12]),
    limb(['RightUpLeg', 'RightLeg', 'RightFoot'], [-9, -2, 0], [44, 43], [0, 0, 12]),
  ],
};

const BONE: Readonly<Record<Exclude<MotionJoint, 'hips'>, string>> = {
  spine: 'Spine',
  chest: 'Spine1',
  neck: 'Neck',
  head: 'Head',
  leftUpperArm: 'LeftArm',
  leftForearm: 'LeftForeArm',
  leftHand: 'LeftHand',
  rightUpperArm: 'RightArm',
  rightForearm: 'RightForeArm',
  rightHand: 'RightHand',
  leftThigh: 'LeftUpLeg',
  leftShin: 'LeftLeg',
  leftFoot: 'LeftFoot',
  rightThigh: 'RightUpLeg',
  rightShin: 'RightLeg',
  rightFoot: 'RightFoot',
};

type Angles = [number, number, number];
/** 某一时刻的姿势：关节角度（度，[x, y, z]）+ 髋部起伏（米） */
interface Frame {
  joints: Partial<Record<Exclude<MotionJoint, 'hips'>, Angles>>;
  hips?: Angles;
  rootY?: number;
}

/** 站立时手臂、腿的自然角度（与 poses.ts 的 stand 一致） */
const STAND: Frame['joints'] = {
  leftUpperArm: [0, 0, 6],
  rightUpperArm: [0, 0, -6],
  leftForearm: [-8, 0, 0],
  rightForearm: [-8, 0, 0],
  leftThigh: [0, 0, 3],
  rightThigh: [0, 0, -3],
};

const TAU = Math.PI * 2;
const smooth = (s: number) => s * s * (3 - 2 * s);

/** 分段平滑曲线：keys = [时间, 值]，两端保持 */
function curve(keys: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t1) return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0 || 1));
  }
  return keys[keys.length - 1][1];
}

interface BuiltinSpec {
  id: string;
  label: string;
  description: string;
  durationSec: number;
  loop: boolean;
  frame: (t: number) => Frame;
}

const BUILTIN_SPECS: readonly BuiltinSpec[] = [
  {
    id: 'builtin:idle',
    label: '待机呼吸',
    description: 'idle breathing and slight body sway while standing (loop)',
    durationSec: 4,
    loop: true,
    frame: (t) => {
      const breath = Math.sin((TAU * t) / 4);
      const sway = Math.sin((TAU * t) / 4 + 1);
      return {
        joints: {
          ...STAND,
          spine: [0, 2 * sway, 0.8 * sway],
          chest: [-1.5 * breath, 0, 0],
          head: [1.5 * breath, 3 * Math.sin((TAU * t) / 4 + 2), 0],
          leftUpperArm: [0, 0, 6 + 1.5 * breath],
          rightUpperArm: [0, 0, -6 - 1.5 * breath],
        },
      };
    },
  },
  {
    id: 'builtin:wave',
    label: '挥手',
    description: 'raise the right hand and wave (loop)',
    durationSec: 2,
    loop: true,
    frame: (t) => ({
      joints: {
        ...STAND,
        chest: [0, -6, 0],
        head: [0, -4, 5],
        rightUpperArm: [-12, 0, -138],
        rightForearm: [0, 0, -12 + 32 * Math.sin(TAU * 1.5 * t)],
        rightHand: [0, 0, 8 * Math.sin(TAU * 1.5 * t)],
      },
    }),
  },
  {
    id: 'builtin:nod',
    label: '点头',
    description: 'nod twice (agree / greet), about 1.6 s',
    durationSec: 1.6,
    loop: false,
    frame: (t) => {
      const nod = 16 * Math.max(0, Math.sin((TAU * t) / 0.8));
      return { joints: { ...STAND, neck: [nod * 0.35, 0, 0], head: [nod, 0, 0] } };
    },
  },
  {
    id: 'builtin:look-around',
    label: '环顾四周',
    description: 'look left and right while standing (loop)',
    durationSec: 4,
    loop: true,
    frame: (t) => {
      const turn = Math.sin((TAU * t) / 4);
      return {
        joints: {
          ...STAND,
          chest: [0, 10 * turn, 0],
          neck: [0, 15 * turn, 0],
          head: [-3, 40 * turn, 0],
        },
      };
    },
  },
  {
    id: 'builtin:bow',
    label: '鞠躬 / 行礼',
    description: 'bow from the waist and straighten up, about 2 s',
    durationSec: 2,
    loop: false,
    frame: (t) => {
      const bend = curve(
        [
          [0, 0],
          [0.7, 1],
          [1.3, 1],
          [2, 0],
        ],
        t
      );
      return {
        joints: {
          ...STAND,
          spine: [32 * bend, 0, 0],
          chest: [14 * bend, 0, 0],
          head: [10 * bend, 0, 0],
          leftUpperArm: [-10 * bend, 0, 6],
          rightUpperArm: [-10 * bend, 0, -6],
        },
      };
    },
  },
  {
    id: 'builtin:jump',
    label: '原地跳起',
    description: 'crouch, jump up in place and land, about 1.4 s',
    durationSec: 1.4,
    loop: false,
    frame: (t) => {
      // 下蹲 → 起跳腾空 → 落地缓冲 → 站直
      const crouch = curve(
        [
          [0, 0],
          [0.35, 1],
          [0.5, 0],
          [0.75, 0.1],
          [0.95, 0.8],
          [1.4, 0],
        ],
        t
      );
      const air = curve(
        [
          [0.35, 0],
          [0.6, 1],
          [0.85, 0],
        ],
        t
      );
      return {
        rootY: -0.22 * crouch + 0.38 * air,
        joints: {
          spine: [18 * crouch, 0, 0],
          head: [-12 * crouch, 0, 0],
          leftThigh: [-55 * crouch - 20 * air, 0, 4],
          rightThigh: [-55 * crouch - 20 * air, 0, -4],
          leftShin: [90 * crouch + 35 * air, 0, 0],
          rightShin: [90 * crouch + 35 * air, 0, 0],
          leftFoot: [-35 * crouch, 0, 0],
          rightFoot: [-35 * crouch, 0, 0],
          leftUpperArm: [35 * crouch - 120 * air, 0, 10],
          rightUpperArm: [35 * crouch - 120 * air, 0, -10],
          leftForearm: [-20, 0, 0],
          rightForearm: [-20, 0, 0],
        },
      };
    },
  },
];

const FPS = 30;

/** 内置动作的 BVH 文本（也是导出 / 测试的样例） */
export function builtinMotionBvh(id: string): string | null {
  const spec = BUILTIN_SPECS.find((item) => item.id === id);
  if (!spec) return null;
  const count = Math.round(spec.durationSec * FPS) + 1;
  const frames = Array.from({ length: count }, (_, index) => {
    const frame = spec.frame(index / FPS);
    const record: Record<string, Partial<Record<BvhChannel, number>>> = {
      Hips: {
        Yposition: LEG_LENGTH + ((frame.rootY ?? 0) * LEG_LENGTH) / MANNEQUIN_HIP_HEIGHT,
        Xrotation: frame.hips?.[0] ?? 0,
        Yrotation: frame.hips?.[1] ?? 0,
        Zrotation: frame.hips?.[2] ?? 0,
      },
    };
    for (const [joint, angles] of Object.entries(frame.joints) as [
      Exclude<MotionJoint, 'hips'>,
      Angles,
    ][]) {
      record[BONE[joint]] = { Xrotation: angles[0], Yrotation: angles[1], Zrotation: angles[2] };
    }
    return record;
  });
  return serializeBvh(SKELETON, 1 / FPS, frames);
}

export interface BuiltinMotionInfo {
  id: string;
  label: string;
  description: string;
  durationSec: number;
  /** 建议循环播放 */
  loop: boolean;
}

export const BUILTIN_MOTIONS: readonly BuiltinMotionInfo[] = BUILTIN_SPECS.map(
  ({ id, label, description, durationSec, loop }) => ({ id, label, description, durationSec, loop })
);

let cache: Map<string, MotionClip> | null = null;

/** 全部内置动作片段（首次调用时生成并缓存） */
export function builtinMotionClips(): ReadonlyMap<string, MotionClip> {
  if (cache) return cache;
  cache = new Map();
  for (const spec of BUILTIN_SPECS) {
    const text = builtinMotionBvh(spec.id);
    if (!text) continue;
    cache.set(
      spec.id,
      retargetBvh(parseBvh(text), {
        id: spec.id,
        name: spec.label,
        source: 'builtin',
        description: spec.description,
      })
    );
  }
  return cache;
}
