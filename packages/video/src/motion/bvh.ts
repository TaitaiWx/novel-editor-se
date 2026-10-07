/**
 * BVH（Biovision Hierarchy）解析与序列化（纯函数）。
 *
 * BVH 是动作捕捉与「文字 → 动作」AI 模型（MDM / MotionGPT / T2M-GPT 等）最常见的输出格式：
 * - HIERARCHY：ROOT / JOINT / End Site 嵌套，每个关节有 OFFSET（静止姿势下相对父关节的位置）与 CHANNELS
 * - MOTION：Frames / Frame Time，之后每行一帧，按关节出现顺序依次排列各关节的通道值
 *
 * 旋转通道的顺序就是欧拉角的组合顺序（例如 Zrotation Xrotation Yrotation → R = Rz·Rx·Ry），单位为度；
 * 位置通道单位随文件（厘米 / 英寸 / 米都有），重定向时按腿长换算。
 * 只按 ASCII 关键字解析，关节名原样保留。
 */

export type BvhChannel =
  | 'Xposition'
  | 'Yposition'
  | 'Zposition'
  | 'Xrotation'
  | 'Yrotation'
  | 'Zrotation';

const CHANNELS: readonly BvhChannel[] = [
  'Xposition',
  'Yposition',
  'Zposition',
  'Xrotation',
  'Yrotation',
  'Zrotation',
];

export interface BvhJoint {
  name: string;
  /** 父关节下标（根为 -1） */
  parent: number;
  offset: [number, number, number];
  channels: BvhChannel[];
  /** 该关节第一个通道在一帧数据里的下标 */
  channelOffset: number;
  /** End Site 的偏移（叶子关节才有） */
  endSite?: [number, number, number];
  children: number[];
}

export interface BvhData {
  joints: BvhJoint[];
  /** 每帧秒数 */
  frameTime: number;
  frameCount: number;
  /** 每帧的通道值（长度 = 通道总数） */
  frames: number[][];
  channelCount: number;
}

export class BvhParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BvhParseError';
  }
}

/** 解析上限：防止异常文件占满内存（5MB 文本远小于这些上限） */
export const BVH_MAX_JOINTS = 256;
export const BVH_MAX_FRAMES = 20_000;

class Tokens {
  private index = 0;
  constructor(private readonly list: string[]) {}
  peek(): string | undefined {
    return this.list[this.index];
  }
  next(): string {
    const token = this.list[this.index];
    if (token === undefined) throw new BvhParseError('BVH 文件意外结束');
    this.index += 1;
    return token;
  }
  expect(word: string): void {
    const token = this.next();
    if (token.toUpperCase() !== word.toUpperCase()) {
      throw new BvhParseError(`BVH 格式错误：期望 ${word}，实际是 ${token}`);
    }
  }
  number(): number {
    const token = this.next();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new BvhParseError(`BVH 格式错误：${token} 不是数字`);
    return value;
  }
  get position(): number {
    return this.index;
  }
}

function readOffset(tokens: Tokens): [number, number, number] {
  tokens.expect('OFFSET');
  return [tokens.number(), tokens.number(), tokens.number()];
}

function readChannels(tokens: Tokens): BvhChannel[] {
  tokens.expect('CHANNELS');
  const count = tokens.number();
  if (!Number.isInteger(count) || count < 0 || count > 6) {
    throw new BvhParseError(`BVH 格式错误：通道数 ${count} 无效`);
  }
  const channels: BvhChannel[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = tokens.next();
    const channel = CHANNELS.find((item) => item.toLowerCase() === raw.toLowerCase());
    if (!channel) throw new BvhParseError(`BVH 格式错误：未知通道 ${raw}`);
    channels.push(channel);
  }
  return channels;
}

/** 解析 BVH 文本；格式错误时抛出 BvhParseError（信息可直接展示给作者） */
export function parseBvh(text: string): BvhData {
  const [head, motion] = splitSections(text);
  const tokens = new Tokens(head.split(/\s+/).filter(Boolean));
  tokens.expect('HIERARCHY');
  const joints: BvhJoint[] = [];
  let channelCount = 0;

  const readJoint = (parent: number): void => {
    // 关节名可能带空格（例如 3ds Max 的 "Bip01 L UpperArm"）：读到 { 为止
    const parts: string[] = [];
    while (tokens.peek() !== undefined && tokens.peek() !== '{') parts.push(tokens.next());
    const name = parts.join(' ');
    if (!name) throw new BvhParseError('BVH 格式错误：关节缺少名字');
    tokens.expect('{');
    const joint: BvhJoint = {
      name,
      parent,
      offset: readOffset(tokens),
      channels: [],
      channelOffset: channelCount,
      children: [],
    };
    if (joints.length >= BVH_MAX_JOINTS) throw new BvhParseError('BVH 关节过多');
    const index = joints.length;
    joints.push(joint);
    if (parent >= 0) joints[parent].children.push(index);
    if (tokens.peek()?.toUpperCase() === 'CHANNELS') {
      joint.channels = readChannels(tokens);
      channelCount += joint.channels.length;
    }
    for (;;) {
      const token = tokens.next().toUpperCase();
      if (token === '}') return;
      if (token === 'JOINT') {
        readJoint(index);
      } else if (token === 'END') {
        tokens.expect('Site');
        tokens.expect('{');
        joint.endSite = readOffset(tokens);
        tokens.expect('}');
      } else {
        throw new BvhParseError(`BVH 格式错误：关节 ${name} 里出现了 ${token}`);
      }
    }
  };

  tokens.expect('ROOT');
  readJoint(-1);
  if (tokens.peek() !== undefined) {
    throw new BvhParseError('BVH 只支持一个 ROOT 关节');
  }

  const { frameCount, frameTime, frames } = parseMotion(motion, channelCount);
  return { joints, frameTime, frameCount, frames, channelCount };
}

/** 按 MOTION 关键字分成层级与动作两段（关键字大小写不敏感，前后必须是空白） */
function splitSections(text: string): [string, string] {
  const match = /(^|\s)MOTION(\s|$)/i.exec(text);
  if (!match) throw new BvhParseError('BVH 缺少 MOTION 段');
  const start = match.index + match[1].length;
  return [text.slice(0, start), text.slice(start + 'MOTION'.length)];
}

function parseMotion(
  text: string,
  channelCount: number
): { frameCount: number; frameTime: number; frames: number[][] } {
  const frameMatch = /Frames\s*:\s*(\d+)/i.exec(text);
  const timeMatch = /Frame\s+Time\s*:\s*([0-9.eE+-]+)/i.exec(text);
  if (!frameMatch || !timeMatch) throw new BvhParseError('BVH 缺少 Frames 或 Frame Time');
  const declared = Number(frameMatch[1]);
  const frameTime = Number(timeMatch[1]);
  if (!(frameTime > 0) || frameTime > 1) throw new BvhParseError('BVH 的 Frame Time 无效');
  if (declared > BVH_MAX_FRAMES) throw new BvhParseError(`BVH 帧数超过 ${BVH_MAX_FRAMES}`);
  const body = text.slice(timeMatch.index + timeMatch[0].length);
  const values = body.split(/\s+/).filter(Boolean).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new BvhParseError('BVH 动作数据里有非数字');
  }
  if (channelCount === 0) {
    return { frameCount: Math.max(1, declared), frameTime, frames: [[]] };
  }
  // 以实际数据为准：文件被截断时只取完整的帧
  const available = Math.floor(values.length / channelCount);
  const frameCount = Math.min(declared, available);
  if (frameCount < 1) throw new BvhParseError('BVH 没有动作帧');
  const frames: number[][] = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(values.slice(i * channelCount, (i + 1) * channelCount));
  }
  return { frameCount, frameTime, frames };
}

/* ----------------------------- 序列化（内置动作 / 测试用） ----------------------------- */

export interface BvhJointSpec {
  name: string;
  offset: [number, number, number];
  channels: BvhChannel[];
  endSite?: [number, number, number];
  children?: BvhJointSpec[];
}

const fmt = (value: number) => {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** 层级规格 + 每帧按关节名给出的通道值 → BVH 文本 */
export function serializeBvh(
  root: BvhJointSpec,
  frameTime: number,
  frames: ReadonlyArray<Readonly<Record<string, Partial<Record<BvhChannel, number>>>>>
): string {
  const lines: string[] = ['HIERARCHY'];
  const order: BvhJointSpec[] = [];
  const write = (joint: BvhJointSpec, depth: number, isRoot: boolean) => {
    const pad = '  '.repeat(depth);
    order.push(joint);
    lines.push(`${pad}${isRoot ? 'ROOT' : 'JOINT'} ${joint.name}`, `${pad}{`);
    lines.push(`${pad}  OFFSET ${joint.offset.map(fmt).join(' ')}`);
    lines.push(`${pad}  CHANNELS ${joint.channels.length} ${joint.channels.join(' ')}`.trimEnd());
    for (const child of joint.children ?? []) write(child, depth + 1, false);
    if (joint.endSite) {
      lines.push(`${pad}  End Site`, `${pad}  {`);
      lines.push(`${pad}    OFFSET ${joint.endSite.map(fmt).join(' ')}`, `${pad}  }`);
    }
    lines.push(`${pad}}`);
  };
  write(root, 0, true);
  lines.push(
    'MOTION',
    `Frames: ${frames.length}`,
    `Frame Time: ${Math.round(frameTime * 1e7) / 1e7}`
  );
  for (const frame of frames) {
    const values: string[] = [];
    for (const joint of order) {
      for (const channel of joint.channels) values.push(fmt(frame[joint.name]?.[channel] ?? 0));
    }
    lines.push(values.join(' '));
  }
  return `${lines.join('\n')}\n`;
}

/** BVH 时长（秒） */
export function bvhDuration(data: BvhData): number {
  return Math.max(data.frameTime, (data.frameCount - 1) * data.frameTime);
}

/** 关节在一帧里的旋转通道（度）与旋转顺序（小写轴名，例如 'zxy'） */
export function bvhJointRotation(
  data: BvhData,
  frame: readonly number[],
  jointIndex: number
): { order: string; degrees: { x: number; y: number; z: number } } {
  const joint = data.joints[jointIndex];
  const degrees = { x: 0, y: 0, z: 0 };
  let order = '';
  joint.channels.forEach((channel, i) => {
    if (!channel.endsWith('rotation')) return;
    const axis = channel[0].toLowerCase() as 'x' | 'y' | 'z';
    order += axis;
    degrees[axis] = frame[joint.channelOffset + i] ?? 0;
  });
  return { order, degrees };
}

/** 关节在一帧里的位置通道（没有位置通道时为 null） */
export function bvhJointPosition(
  data: BvhData,
  frame: readonly number[],
  jointIndex: number
): [number, number, number] | null {
  const joint = data.joints[jointIndex];
  const position: [number, number, number] = [...joint.offset];
  let found = false;
  joint.channels.forEach((channel, i) => {
    if (!channel.endsWith('position')) return;
    found = true;
    const axis = channel === 'Xposition' ? 0 : channel === 'Yposition' ? 1 : 2;
    position[axis] = frame[joint.channelOffset + i] ?? 0;
  });
  return found ? position : null;
}
