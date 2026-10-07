import { describe, expect, it } from 'vitest';
import {
  PREVIZ_JSON_SCHEMA,
  PREVIZ_SCRIPT_VERSION,
  applyEase,
  pinCameraFocus,
  samplePrevizScript,
  validatePrevizScript,
  type PrevizScript,
} from '../src';

function expectOk(raw: unknown, options?: Parameters<typeof validatePrevizScript>[1]) {
  const result = validatePrevizScript(raw, options);
  if (!result.ok) throw new Error(`应当通过校验: ${result.errors.join('; ')}`);
  return result;
}

/** AI 写的关节轨迹：举起右手挥手（循环），顺带抬一下左腿（走路时让给步态） */
const WAVE = {
  tracks: {
    rightUpperArm: [
      [0, 0, 0, -150],
      [0.4, 0, 0, -160],
      [0.8, 0, 0, -150],
    ],
    leftThigh: [
      [0, -10, 0, 0],
      [0.8, -10, 0, 0],
    ],
  },
  loop: true,
};

const RAW = {
  durationSec: 4,
  figures: [
    {
      name: '林舟',
      keys: [
        {
          t: 0,
          x: -2,
          z: 0,
          facing: 90,
          pose: 'walk',
          ease: 'easeOut',
          motion: WAVE,
          lookAt: { figure: '苏晴' },
        },
        { t: 2, x: 0, z: 0, facing: 90, pose: 'stand', motion: 'lib:wave-test' },
        { t: 4, x: 0, z: 0, facing: 0, pose: 'stand', motion: { clip: 'dance-404' } },
      ],
    },
    {
      name: '苏晴',
      keys: [
        {
          t: 0,
          x: 1,
          z: 0,
          facing: -90,
          pose: 'stand',
          hands: { right: { x: 1.2, y: 1, z: 0.4 } },
          motion: { generate: '紧张地搓手' },
        },
      ],
    },
  ],
  camera: [
    { t: 0, shotSize: 'full', follow: '林舟' },
    { t: 2, shotSize: 'medium' },
    {
      t: 4,
      shotSize: 'medium',
      position: [0, 2, 5],
      target: { x: 0, y: 1.2, z: 0 },
      ease: 'linear',
    },
  ],
  props: [
    {
      kind: 'crate',
      size: [1, 0.5, 0.5],
      color: '#AA8866',
      keys: [
        { t: 0, x: -1, z: -1, facing: 0 },
        { t: 4, x: 1, z: -1, y: 0.5, facing: 90, ease: 'linear' },
      ],
    },
    { type: 'cart', name: '马车', size: { w: 2, h: 1.5, d: 1 }, x: 3, z: -3 },
    { kind: 'unicorn' },
  ],
};

describe('预演脚本第 2 版：校验', () => {
  const { script, warnings } = expectOk(RAW);

  it('版本号升级；schema 列出新字段', () => {
    expect(script.version).toBe(PREVIZ_SCRIPT_VERSION);
    const keyProps = PREVIZ_JSON_SCHEMA.properties.figures.items.properties.keys.items.properties;
    expect(Object.keys(keyProps)).toEqual(
      expect.arrayContaining(['ease', 'motion', 'lookAt', 'hands'])
    );
    expect(Object.keys(PREVIZ_JSON_SCHEMA.properties.camera.items.properties)).toEqual(
      expect.arrayContaining(['follow', 'position', 'target', 'ease'])
    );
  });

  it('动作：关节轨迹原样保留；旧版的动作片段引用（字符串 / clip）静默丢弃，回退到姿势', () => {
    const [k0, k1, k2] = script.figures[0].keys;
    expect(k0.ease).toBe('ease-out');
    expect(k0.motion).toEqual(WAVE);
    expect(k1.motion).toBeUndefined();
    expect(k2.motion).toBeUndefined();
    expect(k2.pose).toBe('stand');
    expect(warnings.some((item) => item.includes('dance-404') || item.includes('wave-test'))).toBe(
      false
    );
    // 生成描述保留，等 MotionProvider / 追加请求生成轨迹
    expect(script.figures[1].keys[0].motion).toEqual({ generate: '紧张地搓手' });
  });

  it('视线与跟随里的人物名换成人物 id；手部目标夹值', () => {
    expect(script.figures[0].keys[0].lookAt).toEqual({ figure: 'f2' });
    expect(script.figures[1].keys[0].hands).toEqual({ right: { x: 1.2, y: 1, z: 0.4 } });
    expect(script.camera[0].follow).toBe('f1');
    // 没写 follow 的下一个机位沿用跟随
    expect(script.camera[1].follow).toBe('f1');
    expect(script.camera[2].position).toEqual({ x: 0, y: 2, z: 5 });
    expect(script.camera[2].target).toEqual({ x: 0, y: 1.2, z: 0 });
  });

  it('道具：尺寸 / 颜色 / 关键帧；不认识但有名字的物体用方块表示；什么都没有的忽略', () => {
    expect(script.props).toHaveLength(2);
    expect(script.props[0]).toMatchObject({
      kind: 'crate',
      x: -1,
      z: -1,
      size: [1, 0.5, 0.5],
      color: '#aa8866',
    });
    expect(script.props[0].keys).toHaveLength(2);
    expect(script.props[1]).toMatchObject({ kind: 'box', name: '马车', size: [2, 1.5, 1], x: 3 });
    expect(warnings.some((item) => item.includes('unicorn'))).toBe(true);
  });
});

describe('预演脚本第 2 版：采样', () => {
  const { script } = expectOk(RAW);

  it('缓动：ease-out 前半段走得更远', () => {
    expect(applyEase('ease-out', 0.5, 'linear')).toBe(0.75);
    expect(applyEase(undefined, 0.5, 'linear')).toBe(0.5);
    const sample = samplePrevizScript(script, 1);
    expect(sample.figures[0].x).toBeCloseTo(-2 + 2 * 0.75, 5);
  });

  it('动作：区间内权重为 1，接近下一关键帧时淡出到姿势；没有轨迹的关键帧只用姿势', () => {
    const early = samplePrevizScript(script, 0.5).figures[0];
    expect(early.motion?.joints.rightUpperArm?.weight).toBe(1);
    // 走路时腿交给步态（权重减弱），手臂仍然挥手
    expect(early.motion?.joints.leftThigh?.weight ?? 0).toBeLessThan(1);
    // 下一关键帧没有动作：到 2 秒前挥手淡出
    const fading = samplePrevizScript(script, 1.9).figures[0];
    const weight = fading.motion?.joints.rightUpperArm?.weight ?? 0;
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(1);
    expect(samplePrevizScript(script, 3).figures[0].motion).toBeUndefined();
    // 苏晴只有待生成的描述：完全按姿势
    expect(samplePrevizScript(script, 0.5).figures[1].motion).toBeUndefined();
  });

  it('视线：林舟面向右侧（+x），苏晴在正前方，头不需要转；朝向变化后头转向苏晴', () => {
    const atStart = samplePrevizScript(script, 0).figures[0];
    expect(Math.abs(atStart.joints.head?.[1] ?? 0)).toBeLessThan(1);
    const turned: PrevizScript = {
      ...script,
      figures: [
        {
          ...script.figures[0],
          keys: [{ t: 0, x: 0, z: 0, facing: 0, pose: 'stand', lookAt: { figure: 'f2' } }],
        },
        script.figures[1],
      ],
    };
    const head = samplePrevizScript(turned, 0).figures[0].joints.head;
    // 苏晴在 +x：面向镜头时向人物自己的左侧（+Y 转角）转头，有上限
    expect(head?.[1]).toBeGreaterThan(30);
    expect(head?.[1]).toBeLessThanOrEqual(60);
  });

  it('手部目标随关键帧给出权重', () => {
    const su = samplePrevizScript(script, 1).figures[1];
    expect(su.hands?.right).toEqual({ x: 1.2, y: 1, z: 0.4, weight: 1 });
  });

  it('道具关键帧：位置 / 高度 / 朝向插值', () => {
    const prop = samplePrevizScript(script, 2).props[0];
    expect(prop.x).toBeCloseTo(0, 5);
    expect(prop.y).toBeCloseTo(0.25, 5);
    expect(prop.facing).toBeCloseTo(45, 5);
    expect(samplePrevizScript(script, 2).props[1].y).toBe(0);
  });

  it('机位：跟随人物的注视点随人物移动；绝对机位按权重淡入', () => {
    const start = samplePrevizScript(script, 0).camera;
    expect(start.focusX).toBeCloseTo(-2, 5);
    expect(start.override).toBeUndefined();
    const mid = samplePrevizScript(script, 3).camera;
    expect(mid.override?.weight).toBeCloseTo(0.5, 5);
    const end = samplePrevizScript(script, 4).camera;
    expect(end.override).toEqual({ position: [0, 2, 5], target: [0, 1.2, 0], weight: 1 });
  });

  it('pinCameraFocus 不改动跟随 / 绝对机位', () => {
    const pinned = pinCameraFocus(script);
    expect(pinned.camera).toEqual(script.camera);
  });
});
