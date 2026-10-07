import { describe, expect, it } from 'vitest';
import {
  PREVIZ_JSON_SCHEMA,
  PREVIZ_MAX_DURATION,
  PREVIZ_POSES,
  PREVIZ_SHOT_SIZES,
  PREVIZ_STAGE_LIMIT,
  SHOT_SIZES,
  defaultPrevizScript,
  lerpDegrees,
  normalizePrevizPose,
  orbitScriptCamera,
  parsePrevizFileName,
  pinCameraFocus,
  previzFileName,
  previzFrameCount,
  previzShotSizeOf,
  samplePrevizScript,
  translateFigureTrack,
  validatePrevizScript,
  type PrevizScript,
} from '../src';

function expectOk(raw: unknown, options?: Parameters<typeof validatePrevizScript>[1]) {
  const result = validatePrevizScript(raw, options);
  if (!result.ok) throw new Error(`应当通过校验: ${result.errors.join('; ')}`);
  return result;
}

const WALK: PrevizScript = {
  version: 1,
  durationSec: 4,
  mood: 'dusk',
  figures: [
    {
      id: 'f1',
      name: 'A',
      color: '#c9a27a',
      keys: [
        { t: 0, x: -2, z: 0, facing: 90, pose: 'walk' },
        { t: 2, x: 0, z: 0, facing: 90, pose: 'walk' },
        { t: 4, x: 0, z: 0, facing: 0, pose: 'sit' },
      ],
    },
  ],
  camera: [
    { t: 0, shotSize: 'full', lens: 35, angle: 'eye', yaw: 0, pitch: 0, height: 0 },
    { t: 4, shotSize: 'medium', lens: 35, angle: 'eye', yaw: 30, pitch: 0, height: 0 },
  ],
  props: [{ id: 'p1', kind: 'chair', x: 0, z: -0.3, facing: 0 }],
};

describe('validatePrevizScript', () => {
  it('解析标准结构并保持数值', () => {
    const { script, warnings } = expectOk(WALK);
    expect(warnings).toEqual([]);
    expect(script).toEqual(WALK);
  });

  it('容忍字段别名：duration / characters / keyframes / position / rotation / focalLength / lighting', () => {
    const { script } = expectOk({
      duration: '5s',
      lighting: 'Sunset',
      characters: [
        {
          character: 'Lin',
          keyframes: [
            { time: 0, position: { x: 1, z: 2 }, rotation: -90, action: 'Walking' },
            { at: 3, pos: [2, 3], heading: '45', state: 'sitting' },
          ],
        },
      ],
      cameras: [
        { time: 0, framing: 'Close Up', focalLength: 85, cameraAngle: 'low-angle', orbit: 20 },
      ],
      objects: [{ type: 'Tables', position: [1, -2] }],
    });
    expect(script.durationSec).toBe(5);
    expect(script.mood).toBe('dusk');
    expect(script.figures[0]).toMatchObject({ id: 'f1', name: 'Lin' });
    expect(script.figures[0].keys).toEqual([
      { t: 0, x: 1, z: 2, facing: -90, pose: 'walk' },
      { t: 3, x: 2, z: 3, facing: 45, pose: 'sit' },
    ]);
    expect(script.camera[0]).toMatchObject({
      shotSize: 'close-up',
      lens: 85,
      angle: 'low',
      yaw: 20,
    });
    expect(script.props).toEqual([{ id: 'p1', kind: 'table', x: 1, z: -2, facing: 0 }]);
  });

  it('景别接受分镜景别（SHOT_SIZES）与英文缩写', () => {
    SHOT_SIZES.forEach((size, index) => {
      expect(previzShotSizeOf(size)).toBe(PREVIZ_SHOT_SIZES[index]);
    });
    expect(previzShotSizeOf('MCU')).toBe('medium-close');
    expect(previzShotSizeOf('wide shot')).toBe('wide');
    expect(previzShotSizeOf('???')).toBe('medium');
  });

  it('夹值：时长 ≤ 10、站位 ±8、焦距 18–135、俯仰、关节 ±170，关键帧时间夹到时长内', () => {
    const { script, warnings } = expectOk({
      durationSec: 30,
      figures: [
        {
          name: 'A',
          keys: [
            {
              t: 99,
              x: 1000,
              z: -50,
              facing: 540,
              pose: 'stand',
              joints: { head: [0, 400, 0], rightupperarm: -500, tail: [1, 2, 3] },
            },
          ],
        },
      ],
      camera: [{ t: -3, shotSize: 'medium', lens: 400, pitch: 99, height: -9 }],
    });
    expect(script.durationSec).toBe(PREVIZ_MAX_DURATION);
    expect(warnings.some((item) => item.includes('30'))).toBe(true);
    const key = script.figures[0].keys[0];
    expect(key).toMatchObject({
      t: 10,
      x: PREVIZ_STAGE_LIMIT,
      z: -PREVIZ_STAGE_LIMIT,
      facing: 180,
    });
    expect(key.joints).toEqual({ head: [0, 170, 0], rightUpperArm: [-170, 0, 0] });
    expect(warnings.some((item) => item.includes('tail'))).toBe(true);
    expect(script.camera[0]).toMatchObject({ t: 0, lens: 135, pitch: 60, height: -2 });
  });

  it('未知姿势回退 stand 并警告；关键帧按时间排序；缺省值沿用上一帧', () => {
    const { script, warnings } = expectOk({
      durationSec: 4,
      figures: [
        {
          name: 'A',
          keys: [
            { t: 3, x: 1, z: 0, pose: 'moonwalk' },
            { t: 1, x: -1, z: 0, facing: 30, pose: 'run' },
          ],
        },
      ],
      camera: { shotSize: 'wide' },
    });
    expect(warnings.some((item) => item.includes('moonwalk'))).toBe(true);
    expect(script.figures[0].keys.map((key) => [key.t, key.pose])).toEqual([
      [1, 'run'],
      [3, 'stand'],
    ]);
    expect(script.camera).toHaveLength(1);
  });

  it('没有人物时按镜头人物站成一排；没有机位时用固定机位；两者都没有时报错', () => {
    const noFigures = expectOk({ camera: [{ shotSize: 'full' }] }, { characters: ['A', 'B'] });
    expect(noFigures.script.figures.map((item) => [item.name, item.keys[0].x])).toEqual([
      ['A', -0.45],
      ['B', 0.45],
    ]);
    const noCamera = expectOk(
      { figures: [{ name: 'A', keys: [{ x: 0, z: 0 }] }] },
      { shotSize: 'close-up' }
    );
    expect(noCamera.script.camera[0].shotSize).toBe('close-up');
    expect(validatePrevizScript({ summary: 'x' }).ok).toBe(false);
    expect(validatePrevizScript('nope').ok).toBe(false);
  });

  it('JSON Schema 列出全部姿势与景别', () => {
    const keyProps = PREVIZ_JSON_SCHEMA.properties.figures.items.properties.keys.items.properties;
    expect(keyProps.pose.enum).toEqual([...PREVIZ_POSES]);
    expect(PREVIZ_JSON_SCHEMA.properties.camera.items.properties.shotSize.enum).toEqual([
      ...PREVIZ_SHOT_SIZES,
    ]);
  });

  it('姿势别名', () => {
    expect(normalizePrevizPose('Draw Sword')).toBe('draw-sword');
    expect(normalizePrevizPose('hug')).toBe('embrace');
    expect(normalizePrevizPose('look_back')).toBe('look-back');
    expect(normalizePrevizPose('fly')).toBeUndefined();
  });
});

describe('samplePrevizScript', () => {
  it('位置匀速插值，朝向 / 姿势平滑过渡，时间夹在 [0, 时长]', () => {
    const start = samplePrevizScript(WALK, -1);
    expect(start.t).toBe(0);
    expect(start.figures[0]).toMatchObject({ x: -2, z: 0, facing: 90, poseFrom: 'walk' });
    const middle = samplePrevizScript(WALK, 1);
    expect(middle.figures[0].x).toBeCloseTo(-1, 5);
    const settling = samplePrevizScript(WALK, 3);
    expect(settling.figures[0]).toMatchObject({ poseFrom: 'walk', poseTo: 'sit', mix: 0.5 });
    expect(settling.figures[0].facing).toBeCloseTo(45, 5);
    const end = samplePrevizScript(WALK, 99);
    expect(end.t).toBe(4);
    expect(end.figures[0]).toMatchObject({ x: 0, facing: 0, poseFrom: 'sit', poseTo: 'sit' });
  });

  it('步态：移动中的 walk 有摆腿权重，相位随距离增长；静止时权重为 0', () => {
    const a = samplePrevizScript(WALK, 0.5).figures[0];
    const b = samplePrevizScript(WALK, 1.5).figures[0];
    expect(a.gait.walk).toBe(1);
    expect(b.gait.phase).toBeGreaterThan(a.gait.phase);
    expect(b.gait.phase - a.gait.phase).toBeCloseTo((1 / 1.4) * Math.PI * 2, 5);
    expect(samplePrevizScript(WALK, 3).figures[0].gait.walk).toBe(0);
  });

  it('机位：景别高度对数插值（推近）、环绕最短弧，焦点默认对准人物中心', () => {
    const start = samplePrevizScript(WALK, 0).camera;
    const end = samplePrevizScript(WALK, 4).camera;
    const middle = samplePrevizScript(WALK, 2).camera;
    expect(start.framingHeight).toBeCloseTo(2.3, 5);
    expect(end.framingHeight).toBeCloseTo(1, 5);
    expect(middle.framingHeight).toBeCloseTo(Math.sqrt(2.3), 5);
    expect(middle.yaw).toBeCloseTo(15, 5);
    expect(start.focusX).toBeCloseTo(-2, 5);
    expect(end.focusX).toBeCloseTo(0, 5);
    expect(lerpDegrees(170, -170, 0.5)).toBe(180);
  });

  it('同一时刻多次采样结果一致（导出视频逐帧确定）', () => {
    expect(samplePrevizScript(WALK, 2.345)).toEqual(samplePrevizScript(WALK, 2.345));
    expect(previzFrameCount(WALK, 24)).toBe(96);
  });
});

describe('默认脚本与微调', () => {
  it('默认脚本：人物站成一排、面向镜头，机位从宽一级缓慢推近', () => {
    const script = defaultPrevizScript({
      characters: ['A', 'B', 'C'],
      shotSize: 'medium',
      durationSec: 6,
    });
    expect(script.figures.map((item) => item.keys[0])).toEqual([
      { t: 0, x: -0.9, z: 0, facing: 0, pose: 'stand' },
      { t: 0, x: 0, z: 0, facing: 0, pose: 'stand' },
      { t: 0, x: 0.9, z: 0, facing: 0, pose: 'stand' },
    ]);
    expect(script.camera.map((key) => [key.t, key.shotSize])).toEqual([
      [0, 'full'],
      [6, 'medium'],
    ]);
    expect(validatePrevizScript(script)).toMatchObject({ ok: true, warnings: [] });
    const long = defaultPrevizScript({ characters: [], shotSize: 'extreme-wide', durationSec: 20 });
    expect(long.durationSec).toBe(10);
    expect(long.camera).toHaveLength(1);
    expect(long.figures).toHaveLength(1);
  });

  it('平移整段走位夹在舞台内；环绕机位改所有关键帧；固定焦点', () => {
    const moved = translateFigureTrack(WALK, 'f1', 100, 1);
    expect(moved.figures[0].keys.map((key) => [key.x, key.z])).toEqual([
      [8, 1],
      [8, 1],
      [8, 1],
    ]);
    expect(WALK.figures[0].keys[0].x).toBe(-2);
    const orbited = orbitScriptCamera(WALK, 170);
    expect(orbited.camera.map((key) => key.yaw)).toEqual([170, -160]);
    const pinned = pinCameraFocus(WALK);
    expect(pinned.camera.map((key) => key.focus)).toEqual([
      { x: -2, z: 0 },
      { x: 0, z: 0 },
    ]);
  });

  it('文件名：镜头N-预演.<ext> 可往返解析，其他名字不匹配', () => {
    expect(previzFileName(3, 'mp4')).toBe('镜头3-预演.mp4');
    expect(parsePrevizFileName(previzFileName(12, 'webm'))).toEqual({
      shotNumber: 12,
      ext: 'webm',
    });
    expect(parsePrevizFileName(previzFileName(1, 'png'))).toEqual({ shotNumber: 1, ext: 'png' });
    expect(parsePrevizFileName('镜头0-预演.mp4')).toBeNull();
    expect(parsePrevizFileName('镜头1-预演.mov')).toBeNull();
    expect(parsePrevizFileName('../镜头1-预演.mp4')).toBeNull();
  });
});
