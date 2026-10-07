/**
 * E2E 用的小 BVH（Mixamo 式命名、T-pose 静止姿势）：右臂从水平抬起并来回摆动，验证外部 BVH 能导入动作库、
 * 被预演脚本引用并重定向到木偶。
 */
const CHANNELS = 'CHANNELS 3 Zrotation Xrotation Yrotation';

const HIERARCHY = `HIERARCHY
ROOT mixamorig:Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT mixamorig:Spine
  {
    OFFSET 0 10 0
    ${CHANNELS}
    JOINT mixamorig:Spine2
    {
      OFFSET 0 30 0
      ${CHANNELS}
      JOINT mixamorig:Neck
      {
        OFFSET 0 20 0
        ${CHANNELS}
        JOINT mixamorig:Head
        {
          OFFSET 0 8 0
          ${CHANNELS}
          End Site
          {
            OFFSET 0 18 0
          }
        }
      }
      JOINT mixamorig:LeftArm
      {
        OFFSET 18 18 0
        ${CHANNELS}
        JOINT mixamorig:LeftForeArm
        {
          OFFSET 28 0 0
          ${CHANNELS}
          End Site
          {
            OFFSET 25 0 0
          }
        }
      }
      JOINT mixamorig:RightArm
      {
        OFFSET -18 18 0
        ${CHANNELS}
        JOINT mixamorig:RightForeArm
        {
          OFFSET -28 0 0
          ${CHANNELS}
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
    ${CHANNELS}
    JOINT mixamorig:LeftLeg
    {
      OFFSET 0 -45 0
      ${CHANNELS}
      End Site
      {
        OFFSET 0 -45 0
      }
    }
  }
  JOINT mixamorig:RightUpLeg
  {
    OFFSET -9 0 0
    ${CHANNELS}
    JOINT mixamorig:RightLeg
    {
      OFFSET 0 -45 0
      ${CHANNELS}
      End Site
      {
        OFFSET 0 -45 0
      }
    }
  }
}`;

/** 通道总数：根 6 + 12 个关节 × 3 */
const CHANNEL_COUNT = 42;
/** 各关节 Zrotation 在一帧里的下标 */
const LEFT_ARM_Z = 18;
const RIGHT_ARM_Z = 24;
const RIGHT_FOREARM_Z = 27;

export function createWaveBvh(frames = 24, fps = 24): string {
  const rows: string[] = [];
  for (let f = 0; f < frames; f += 1) {
    const row = new Array<number>(CHANNEL_COUNT).fill(0);
    row[1] = 90;
    // 左臂放下；右臂举起并摆动前臂
    row[LEFT_ARM_Z] = -80;
    row[RIGHT_ARM_Z] = -50;
    row[RIGHT_FOREARM_Z] = -60 + 25 * Math.sin((f / frames) * Math.PI * 2);
    rows.push(row.map((value) => String(Math.round(value * 100) / 100)).join(' '));
  }
  return `${HIERARCHY}\nMOTION\nFrames: ${frames}\nFrame Time: ${1 / fps}\n${rows.join('\n')}\n`;
}
