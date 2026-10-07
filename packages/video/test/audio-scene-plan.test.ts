import { describe, expect, it } from 'vitest';
import {
  DIALOGUE_GAP_MS,
  bgmGainEnvelope,
  dbToGain,
  edgeEnvelope,
  gainAt,
  mergeIntervals,
  planSceneAudioMix,
  scheduleDialogue,
} from '../src/stitch/audio-scene-plan';

describe('增益计算', () => {
  it('dB → 线性增益：-12dB 约为 0.251，0dB 为 1', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-12)).toBeCloseTo(0.2512, 4);
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 4);
  });

  it('折线插值：两端外延、中间线性', () => {
    const points = [
      { timeMs: 0, value: 0 },
      { timeMs: 100, value: 1 },
      { timeMs: 200, value: 0.5 },
    ];
    expect(gainAt(points, -10)).toBe(0);
    expect(gainAt(points, 50)).toBe(0.5);
    expect(gainAt(points, 150)).toBe(0.75);
    expect(gainAt(points, 999)).toBe(0.5);
    expect(gainAt([], 10)).toBe(1);
  });

  it('有限长声音：首尾短淡入淡出，中间为音量；很短时淡入淡出不超过一半', () => {
    expect(edgeEnvelope(1000, 2000, 0.8, 10)).toEqual([
      { timeMs: 1000, value: 0 },
      { timeMs: 1010, value: 0.8 },
      { timeMs: 2990, value: 0.8 },
      { timeMs: 3000, value: 0 },
    ]);
    expect(edgeEnvelope(0, 8, 1, 10).map((p) => p.timeMs)).toEqual([0, 4, 4, 8]);
  });

  it('合并对白区间：重叠或间隔小于阈值的合并', () => {
    expect(
      mergeIntervals(
        [
          { startMs: 3000, endMs: 4000 },
          { startMs: 0, endMs: 1000 },
          { startMs: 1300, endMs: 2000 },
          { startMs: 5000, endMs: 5000 },
        ],
        500
      )
    ).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 4000 },
    ]);
  });
});

describe('配乐增益：淡入淡出 × 对白压低', () => {
  const base = {
    durationMs: 10_000,
    volume: 0.5,
    fadeInMs: 1000,
    fadeOutMs: 2000,
    duckGain: dbToGain(-12),
    attackMs: 150,
    releaseMs: 350,
  };

  it('没有对白：只有淡入淡出', () => {
    const points = bgmGainEnvelope({ ...base, duckIntervals: [] });
    expect(gainAt(points, 0)).toBe(0);
    expect(gainAt(points, 500)).toBeCloseTo(0.25, 4);
    expect(gainAt(points, 1000)).toBe(0.5);
    expect(gainAt(points, 7000)).toBe(0.5);
    expect(gainAt(points, 9000)).toBeCloseTo(0.25, 4);
    expect(gainAt(points, 10_000)).toBe(0);
  });

  it('对白期间压低约 -12dB，前后有渐变', () => {
    const points = bgmGainEnvelope({
      ...base,
      duckIntervals: [{ startMs: 3000, endMs: 5000 }],
    });
    const ducked = 0.5 * dbToGain(-12);
    expect(gainAt(points, 2850)).toBeCloseTo(0.5, 6);
    expect(gainAt(points, 3000)).toBeCloseTo(ducked, 3);
    expect(gainAt(points, 4000)).toBeCloseTo(ducked, 3);
    expect(gainAt(points, 5000)).toBeCloseTo(ducked, 3);
    expect(gainAt(points, 5350)).toBeCloseTo(0.5, 6);
    // 时间点递增
    const times = points.map((p) => p.timeMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('淡出与压低重叠时两者相乘', () => {
    const points = bgmGainEnvelope({ ...base, duckIntervals: [{ startMs: 8500, endMs: 9500 }] });
    expect(gainAt(points, 9000)).toBeCloseTo(0.5 * 0.5 * dbToGain(-12), 3);
  });

  it('duckGain = 1 表示不压低', () => {
    const points = bgmGainEnvelope({
      ...base,
      duckGain: 1,
      duckIntervals: [{ startMs: 3000, endMs: 5000 }],
    });
    expect(gainAt(points, 4000)).toBe(0.5);
  });
});

describe('对白排布', () => {
  it('写了 startSec 用它，没写的紧接上一句', () => {
    expect(
      scheduleDialogue([
        { durationMs: 1000 },
        { durationMs: 500 },
        { startSec: 4, durationMs: 800 },
        { durationMs: 300 },
      ])
    ).toEqual([0, 1000 + DIALOGUE_GAP_MS, 4000, 4800 + DIALOGUE_GAP_MS]);
  });
});

describe('planSceneAudioMix', () => {
  const shots = [
    {
      id: 'shot-1',
      durationMs: 4000,
      clipAudioDurationMs: 4000,
      dialogue: [{ id: 'l1', sourceId: 'd1', durationMs: 1500 }],
      sfx: [{ id: 's1', sourceId: 'door', atSec: 1, volume: 0.6, durationMs: 800 }],
    },
    {
      id: 'shot-2',
      durationMs: 3000,
      dialogue: [
        { id: 'l1', sourceId: 'd2', startSec: 0.5, durationMs: 1000 },
        // 超出样片结尾的部分截掉
        { id: 'l2', sourceId: 'd3', startSec: 2.5, durationMs: 2000 },
        // 没有配音长度的忽略
        { id: 'l3', sourceId: 'd4', durationMs: 0 },
      ],
    },
  ];

  it('对白放在镜头起点 + startSec，音效放在 atSec，配乐循环铺满并压低', () => {
    const plan = planSceneAudioMix({
      shots,
      transitionMs: 300,
      bgm: { sourceId: 'bgm', durationMs: 3000, volume: 0.4, fadeInMs: 500, fadeOutMs: 1000 },
      ambience: { sourceId: 'rain', durationMs: 60_000, volume: 0.3 },
    });
    expect(plan.durationMs).toBe(7000);
    expect(plan.hasAudio).toBe(true);
    const byId = new Map(plan.voices.map((voice) => [voice.id, voice]));
    expect(byId.get('clip:shot-1')).toMatchObject({ startMs: 0, durationMs: 4000, kind: 'clip' });
    expect(byId.has('clip:shot-2')).toBe(false);
    expect(byId.get('dialogue:shot-1:l1')).toMatchObject({ startMs: 0, durationMs: 1500 });
    expect(byId.get('dialogue:shot-2:l1')).toMatchObject({ startMs: 4500, durationMs: 1000 });
    expect(byId.get('dialogue:shot-2:l2')).toMatchObject({ startMs: 6500, durationMs: 500 });
    expect(byId.has('dialogue:shot-2:l3')).toBe(false);
    const sfx = byId.get('sfx:shot-1:s1');
    expect(sfx).toMatchObject({ startMs: 1000, durationMs: 800 });
    expect(gainAt(sfx?.gain ?? [], 1400)).toBe(0.6);
    const bgm = byId.get('bgm');
    expect(bgm).toMatchObject({ startMs: 0, durationMs: 7000, loop: true });
    // 第一句对白期间压低，两句之间（1500 → 4500，间隔大于渐变）恢复
    expect(gainAt(bgm?.gain ?? [], 1000)).toBeCloseTo(0.4 * dbToGain(-12), 3);
    expect(gainAt(bgm?.gain ?? [], 3000)).toBeCloseTo(0.4, 3);
    expect(gainAt(bgm?.gain ?? [], 5000)).toBeCloseTo(0.4 * dbToGain(-12), 3);
    expect(byId.get('ambience')).toMatchObject({ loop: false, durationMs: 7000 });
    expect(gainAt(byId.get('ambience')?.gain ?? [], 3000)).toBe(0.3);
    expect(plan.duckIntervals).toEqual([
      { startMs: 0, endMs: 1500 },
      { startMs: 4500, endMs: 5500 },
      { startMs: 6500, endMs: 7000 },
    ]);
  });

  it('关闭压低时配乐保持音量；没有任何声音时 hasAudio 为 false', () => {
    const plan = planSceneAudioMix({
      shots,
      ducking: false,
      bgm: { sourceId: 'bgm', durationMs: 10_000, volume: 0.4, fadeInMs: 0, fadeOutMs: 0 },
    });
    const bgm = plan.voices.find((voice) => voice.kind === 'bgm');
    expect(bgm?.loop).toBe(false);
    expect(gainAt(bgm?.gain ?? [], 1000)).toBe(0.4);
    expect(planSceneAudioMix({ shots: [{ id: 'a', durationMs: 1000 }] }).hasAudio).toBe(false);
  });
});
