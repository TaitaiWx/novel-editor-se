/**
 * 动作重定向：把 BVH 骨架（CMU / Mixamo / 3ds Max Biped 等常见命名）的动作映射到预演木偶（mannequin-v1）的关节。
 *
 * 做法（与静止姿势无关，T-pose / A-pose / 手臂下垂都可以）：
 * 1. 按关节名（只比较 ASCII 字母数字，去掉 mixamorig: / Bip01 等前缀，大小写不敏感）找到每个木偶关节对应的 BVH 关节，
 *    名字表可配置（RetargetMap，调用方的覆盖优先）；
 * 2. 由静止姿势的左右髋 / 头顶推出骨架的「左 / 上 / 前」，换算到木偶坐标（Y 向上、面向 +Z、左手在 +X）；
 * 3. 每根骨头先求「木偶静止方向 → BVH 静止方向」的对齐旋转 A，每帧的世界朝向 W = G·A（G 为 BVH 关节的世界旋转），
 *    木偶的局部旋转 = W(父)⁻¹ · W，按帧存成四元数；
 * 4. 根关节的水平位移不用（走位由预演脚本控制），竖直位移按腿长换算为米，作为髋部起伏。
 */
import type { PrevizJoint } from '../previz';
import { bvhJointPosition, bvhJointRotation, type BvhData } from './bvh';
import {
  QUAT_IDENTITY,
  quatFromAxisAngle,
  quatFromBasis,
  quatFromEulerOrder,
  quatFromUnitVectors,
  quatInvert,
  quatMultiply,
  vecAdd,
  vecCross,
  vecNormalize,
  vecRotate,
  vecSub,
  type Quat,
  type Vec3,
} from './quat';

/** 木偶骨架版本（MotionProvider 请求动作时声明的骨架） */
export const MANNEQUIN_SKELETON = 'mannequin-v1';
export type MannequinSkeleton = typeof MANNEQUIN_SKELETON;

/** 动作驱动的关节：预演关节 + 髋部（整体朝向 / 前倾） */
export type MotionJoint = 'hips' | PrevizJoint;

/** 木偶层级（父关节在前），与渲染进程 mannequin.ts 一致 */
export const MOTION_JOINT_PARENTS: Readonly<Record<MotionJoint, MotionJoint | null>> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  leftUpperArm: 'chest',
  leftForearm: 'leftUpperArm',
  leftHand: 'leftForearm',
  rightUpperArm: 'chest',
  rightForearm: 'rightUpperArm',
  rightHand: 'rightForearm',
  leftThigh: 'hips',
  leftShin: 'leftThigh',
  leftFoot: 'leftShin',
  rightThigh: 'hips',
  rightShin: 'rightThigh',
  rightFoot: 'rightShin',
};

export const MOTION_JOINTS = Object.keys(MOTION_JOINT_PARENTS) as MotionJoint[];

/** 骨头的末端关节（用来求 BVH 里的骨头方向） */
const BONE_TIP: Partial<Record<MotionJoint, MotionJoint>> = {
  spine: 'chest',
  chest: 'neck',
  neck: 'head',
  leftUpperArm: 'leftForearm',
  leftForearm: 'leftHand',
  rightUpperArm: 'rightForearm',
  rightForearm: 'rightHand',
  leftThigh: 'leftShin',
  leftShin: 'leftFoot',
  rightThigh: 'rightShin',
  rightShin: 'rightFoot',
};

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
const FORWARD: Vec3 = [0, 0, 1];

/** 木偶静止姿势里每根骨头的方向（世界坐标，木偶站立、面向 +Z、手臂下垂） */
const MANNEQUIN_REST_DIRECTION: Readonly<Record<MotionJoint, Vec3 | null>> = {
  hips: null,
  spine: UP,
  chest: UP,
  neck: UP,
  head: UP,
  leftUpperArm: DOWN,
  leftForearm: DOWN,
  leftHand: DOWN,
  rightUpperArm: DOWN,
  rightForearm: DOWN,
  rightHand: DOWN,
  leftThigh: DOWN,
  leftShin: DOWN,
  leftFoot: FORWARD,
  rightThigh: DOWN,
  rightShin: DOWN,
  rightFoot: FORWARD,
};

/** 木偶站立时的髋高（米），与 poses.ts HIP_HEIGHT 一致 */
export const MANNEQUIN_HIP_HEIGHT = 0.95;

export type RetargetMap = Partial<Record<MotionJoint, readonly string[]>>;

const sided = (side: 'left' | 'right', names: readonly string[]) => {
  const short = side === 'left' ? 'l' : 'r';
  return names.flatMap((name) => [`${side}${name}`, `${short}${name}`, `${name}${short}`]);
};

/** 默认名字表（已规范化：小写字母数字）。前面的优先 */
export const DEFAULT_RETARGET_MAP: Readonly<Record<MotionJoint, readonly string[]>> = {
  hips: ['hips', 'hip', 'pelvis', 'root'],
  spine: ['lowerback', 'abdomen', 'spine', 'spine0', 'spine01', 'waist', 'torso'],
  chest: ['spine2', 'spine02', 'spine1', 'chest', 'upperchest', 'thorax', 'spine3'],
  neck: ['neck', 'neck1', 'neck01'],
  head: ['head'],
  leftUpperArm: sided('left', ['arm', 'upperarm', 'uparm', 'shldr', 'shoulderjoint']),
  leftForearm: sided('left', ['forearm', 'lowerarm', 'elbow']),
  leftHand: sided('left', ['hand', 'wrist']),
  rightUpperArm: sided('right', ['arm', 'upperarm', 'uparm', 'shldr', 'shoulderjoint']),
  rightForearm: sided('right', ['forearm', 'lowerarm', 'elbow']),
  rightHand: sided('right', ['hand', 'wrist']),
  leftThigh: sided('left', ['upleg', 'thigh', 'upperleg', 'hip']),
  leftShin: sided('left', ['leg', 'shin', 'lowerleg', 'calf', 'knee']),
  leftFoot: sided('left', ['foot', 'ankle']),
  rightThigh: sided('right', ['upleg', 'thigh', 'upperleg', 'hip']),
  rightShin: sided('right', ['leg', 'shin', 'lowerleg', 'calf', 'knee']),
  rightFoot: sided('right', ['foot', 'ankle']),
};

/** 关节名规范化：去掉命名空间（a:b 取 b）与 mixamorig / bip01 前缀，只留小写 ASCII 字母数字 */
export function normalizeBoneName(name: string): string {
  const local = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  return local
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(mixamorig|bip0*1|biped|def)/, '');
}

/** 每个木偶关节对应的 BVH 关节下标（找不到的不出现） */
export function matchSkeleton(
  data: BvhData,
  overrides: RetargetMap = {}
): Partial<Record<MotionJoint, number>> {
  const byName = new Map<string, number>();
  data.joints.forEach((joint, index) => {
    const key = normalizeBoneName(joint.name);
    if (key && !byName.has(key)) byName.set(key, index);
  });
  const used = new Set<number>();
  const result: Partial<Record<MotionJoint, number>> = {};
  for (const joint of MOTION_JOINTS) {
    const names = [
      ...(overrides[joint] ?? []).map(normalizeBoneName),
      ...DEFAULT_RETARGET_MAP[joint],
    ];
    for (const name of names) {
      const index = byName.get(name);
      if (index !== undefined && !used.has(index)) {
        result[joint] = index;
        used.add(index);
        break;
      }
    }
  }
  // 根关节兜底：BVH 的 ROOT
  if (result.hips === undefined && !used.has(0)) result.hips = 0;
  return result;
}

/** 静止姿势下各关节的世界位置（BVH 坐标） */
function restPositions(data: BvhData): Vec3[] {
  const positions: Vec3[] = [];
  data.joints.forEach((joint, index) => {
    positions[index] = joint.parent < 0 ? [0, 0, 0] : vecAdd(positions[joint.parent], joint.offset);
  });
  return positions;
}

/**
 * 骨架基准：BVH 坐标 → 木偶坐标的旋转 C（骨架的左 → +X、上 → +Y、前 → +Z）。
 * 推不出来（缺左右腿 / 头）时假定 Y 向上、面向 +Z。
 */
function skeletonBasis(
  data: BvhData,
  rest: readonly Vec3[],
  match: Partial<Record<MotionJoint, number>>
): Quat {
  const at = (joint: MotionJoint) => (match[joint] !== undefined ? rest[match[joint]!] : null);
  const hips = at('hips') ?? rest[0];
  const top = at('head') ?? at('neck') ?? at('chest');
  const left = at('leftThigh') ?? at('leftUpperArm');
  const right = at('rightThigh') ?? at('rightUpperArm');
  if (!top || !left || !right) return QUAT_IDENTITY;
  const up = vecNormalize(vecSub(top, hips));
  const side = vecNormalize(vecSub(left, right));
  if (!up || !side) return QUAT_IDENTITY;
  const forward = vecNormalize(vecCross(side, up));
  if (!forward) return QUAT_IDENTITY;
  const leftAxis = vecCross(up, forward);
  // 骨架基（列）→ 木偶基：C = (骨架基)⁻¹
  return quatInvert(quatFromBasis(leftAxis, up, forward));
}

/** BVH 里一根骨头的静止方向：到末端关节；没有末端关节时取子关节平均方向 / End Site */
function bvhRestDirection(
  data: BvhData,
  rest: readonly Vec3[],
  match: Partial<Record<MotionJoint, number>>,
  joint: MotionJoint
): Vec3 | null {
  const index = match[joint];
  if (index === undefined) return null;
  const tip = BONE_TIP[joint];
  const tipIndex = tip ? match[tip] : undefined;
  if (tipIndex !== undefined) return vecNormalize(vecSub(rest[tipIndex], rest[index]));
  const node = data.joints[index];
  if (node.children.length) {
    const sum = node.children.reduce<Vec3>(
      (acc, child) => vecAdd(acc, data.joints[child].offset),
      [0, 0, 0]
    );
    return vecNormalize(sum);
  }
  return node.endSite ? vecNormalize(node.endSite) : null;
}

export interface MotionClip {
  id: string;
  name: string;
  /** 每帧秒数 */
  frameTime: number;
  frameCount: number;
  durationSec: number;
  /** 每个关节的局部旋转（四元数，按帧连续存放，长度 = 4 × frameCount） */
  rotations: Partial<Record<MotionJoint, Float32Array>>;
  /** 髋部相对第一帧的竖直起伏（米） */
  rootY: Float32Array;
  /** 找到对应关系的关节（用于提示「这个 BVH 只驱动了哪些关节」） */
  mapped: MotionJoint[];
  source: 'builtin' | 'library' | 'generated';
  /** 一句话说明（内置动作有；交给 AI 选择动作） */
  description?: string;
}

export interface RetargetOptions {
  id: string;
  name: string;
  source?: MotionClip['source'];
  description?: string;
  map?: RetargetMap;
  /** 去掉第一帧的整体朝向（动捕演员不一定面向 +Z），默认 true */
  alignHeading?: boolean;
}

/** BVH → 木偶动作片段；一个木偶关节都对不上时抛错 */
export function retargetBvh(data: BvhData, options: RetargetOptions): MotionClip {
  const match = matchSkeleton(data, options.map);
  const mapped = MOTION_JOINTS.filter((joint) => match[joint] !== undefined);
  if (mapped.filter((joint) => joint !== 'hips').length === 0) {
    throw new Error('BVH 的关节名与木偶对不上（需要 Hips / Spine / LeftArm / LeftUpLeg 这类命名）');
  }
  const rest = restPositions(data);
  const basis = skeletonBasis(data, rest, match);
  const basisInv = quatInvert(basis);
  const align: Partial<Record<MotionJoint, Quat>> = {};
  for (const joint of mapped) {
    const ours = MANNEQUIN_REST_DIRECTION[joint];
    const theirs = bvhRestDirection(data, rest, match, joint);
    align[joint] =
      ours && theirs ? quatFromUnitVectors(ours, vecRotate(basis, theirs)) : QUAT_IDENTITY;
  }

  // 腿长：髋到最低点（含 End Site）沿「上」方向的距离，用于把根关节位移换算成米
  const upAxis = vecRotate(basisInv, UP);
  const heightOf = (point: Vec3) =>
    point[0] * upAxis[0] + point[1] * upAxis[1] + point[2] * upAxis[2];
  const hipsIndex = match.hips ?? 0;
  let lowest = heightOf(rest[hipsIndex]);
  data.joints.forEach((joint, index) => {
    lowest = Math.min(lowest, heightOf(rest[index]));
    if (joint.endSite) lowest = Math.min(lowest, heightOf(vecAdd(rest[index], joint.endSite)));
  });
  const legLength = heightOf(rest[hipsIndex]) - lowest;
  const scale = legLength > 1e-6 ? MANNEQUIN_HIP_HEIGHT / legLength : 0;

  const frameCount = data.frameCount;
  const rotations: Partial<Record<MotionJoint, Float32Array>> = {};
  for (const joint of MOTION_JOINTS) rotations[joint] = new Float32Array(frameCount * 4);
  const rootY = new Float32Array(frameCount);
  let heading: Quat | null = null;
  let baseHeight: number | null = null;

  const global: Quat[] = new Array(data.joints.length);
  for (let f = 0; f < frameCount; f += 1) {
    const frame = data.frames[f];
    data.joints.forEach((joint, index) => {
      const { order, degrees } = bvhJointRotation(data, frame, index);
      const local = order ? quatFromEulerOrder(order, degrees) : QUAT_IDENTITY;
      global[index] = joint.parent < 0 ? local : quatMultiply(global[joint.parent], local);
    });
    // 换到木偶坐标：G' = C · G · C⁻¹
    const toOurs = (q: Quat) => quatMultiply(quatMultiply(basis, q), basisInv);
    if (heading === null) {
      const hipsWorld = toOurs(global[hipsIndex]);
      const forward = vecRotate(hipsWorld, FORWARD);
      const yaw = Math.atan2(forward[0], forward[2]);
      heading = options.alignHeading === false ? QUAT_IDENTITY : quatFromAxisAngle('y', -yaw);
    }
    const world: Partial<Record<MotionJoint, Quat>> = {};
    for (const joint of MOTION_JOINTS) {
      const parent = MOTION_JOINT_PARENTS[joint];
      const parentWorld = parent ? (world[parent] ?? QUAT_IDENTITY) : QUAT_IDENTITY;
      const index = match[joint];
      let local: Quat = QUAT_IDENTITY;
      if (index !== undefined) {
        const target = quatMultiply(
          quatMultiply(heading, toOurs(global[index])),
          align[joint] ?? QUAT_IDENTITY
        );
        world[joint] = target;
        local = quatMultiply(quatInvert(parentWorld), target);
      } else {
        world[joint] = parentWorld;
      }
      rotations[joint]!.set(local, f * 4);
    }
    const position = bvhJointPosition(data, frame, hipsIndex);
    if (position) {
      const height = heightOf(position);
      baseHeight ??= height;
      rootY[f] = Math.max(-0.9, Math.min(1, (height - baseHeight) * scale));
    }
  }
  // 没有对应关系的关节不写旋转（保持预设姿势）
  for (const joint of MOTION_JOINTS) {
    if (match[joint] === undefined) delete rotations[joint];
  }
  return {
    id: options.id,
    name: options.name,
    frameTime: data.frameTime,
    frameCount,
    durationSec: Math.max(data.frameTime, (frameCount - 1) * data.frameTime),
    rotations,
    rootY,
    mapped,
    source: options.source ?? 'library',
    description: options.description,
  };
}
