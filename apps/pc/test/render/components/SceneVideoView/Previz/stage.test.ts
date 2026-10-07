// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { defaultPrevizScript, samplePrevizScript, type PrevizScript } from '@novel-editor/video';
import { captureSize, frameRect } from '@/render/components/SceneVideoView/Previz/presets';
import type { PrevizLabel } from '@/render/components/SceneVideoView/Previz/types';

/** 每次 render 时记录辅助元素是否可见、相机是否只取取景框 */
interface RenderRecord {
  helpersVisible: boolean;
  viewOffset: boolean;
  width: number;
  height: number;
  emissive: number;
}

const records: RenderRecord[] = [];
const contextLossCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  /** 没有 WebGL 的测试环境：用假渲染器代替，场景 / 相机 / 射线拾取都是真的 */
  class FakeRenderer {
    shadowMap = { enabled: false, type: 0 };
    toneMapping = 0;
    toneMappingExposure = 1;
    private pixelRatio = 1;
    private size = { width: 0, height: 0 };
    setPixelRatio(value: number) {
      this.pixelRatio = value;
    }
    getPixelRatio() {
      return this.pixelRatio;
    }
    setSize(width: number, height: number) {
      this.size = { width, height };
    }
    render(
      scene: InstanceType<typeof actual.Scene>,
      camera: InstanceType<typeof actual.PerspectiveCamera>
    ) {
      const grid = scene.children.find((child) => child.type === 'GridHelper');
      let emissive = 0;
      scene.traverse((object) => {
        if (
          object instanceof actual.Mesh &&
          object.material instanceof actual.MeshStandardMaterial
        ) {
          emissive = Math.max(emissive, object.material.emissive.getHex());
        }
      });
      records.push({
        helpersVisible: Boolean(grid?.visible),
        viewOffset: Boolean(camera.view?.enabled),
        width: this.size.width,
        height: this.size.height,
        emissive,
      });
    }
    dispose() {}
    forceContextLoss() {
      contextLossCalls.count += 1;
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

const { PrevizStage } = await import('@/render/components/SceneVideoView/Previz/stage');

function makeCanvas(width = 800, height = 500) {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
  canvas.toBlob = (callback: BlobCallback) => callback(new Blob([new Uint8Array([1, 2, 3])]));
  return canvas;
}

/** 世界坐标 → 视口像素 */
function toScreen(stage: InstanceType<typeof PrevizStage>, point: THREE.Vector3) {
  const camera = (stage as unknown as { camera: THREE.PerspectiveCamera }).camera;
  const ndc = point.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * 800, y: ((1 - ndc.y) / 2) * 500 };
}

/** 两个人物、一张桌子、全景机位（固定在原点）的脚本；林舟从左走到中间 */
const SCRIPT: PrevizScript = {
  ...defaultPrevizScript({ characters: ['林舟', '苏晴'], shotSize: 'full', durationSec: 4 }),
  camera: [
    {
      t: 0,
      shotSize: 'full',
      lens: 35,
      angle: 'eye',
      yaw: 0,
      pitch: 0,
      height: 0,
      focus: { x: 0, z: 0 },
    },
  ],
  props: [{ id: 'p1', kind: 'table', x: 0, z: -1.4, facing: 0 }],
};

describe('PrevizStage（假渲染器）', () => {
  beforeEach(() => {
    records.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  function setup(script: PrevizScript = SCRIPT, t = 0) {
    const canvas = makeCanvas();
    const stage = new PrevizStage(canvas);
    stage.resize(800, 500);
    stage.setFrame(16 / 9);
    stage.setSample(samplePrevizScript(script, t));
    return { stage, canvas };
  }

  it('点选：射线命中人物；道具与天空没有命中（道具不可拖动）', () => {
    const { stage } = setup();
    const chest = toScreen(stage, new THREE.Vector3(-0.45, 1.3, 0));
    expect(stage.pick(chest.x, chest.y)).toBe('f1');
    const other = toScreen(stage, new THREE.Vector3(0.45, 1.3, 0));
    expect(stage.pick(other.x, other.y)).toBe('f2');
    const table = toScreen(stage, new THREE.Vector3(0.3, 0.76, -1.4));
    expect(stage.pick(table.x, table.y)).toBeNull();
    expect(stage.pick(400, 2)).toBeNull();
  });

  it('按采样摆放：人物位置 / 朝向跟随脚本时间', () => {
    const walking: PrevizScript = {
      ...SCRIPT,
      figures: [
        {
          ...SCRIPT.figures[0],
          keys: [
            { t: 0, x: -2, z: 0, facing: 90, pose: 'walk' },
            { t: 4, x: 2, z: 0, facing: 90, pose: 'walk' },
          ],
        },
      ],
    };
    const { stage } = setup(walking, 2);
    const middle = toScreen(stage, new THREE.Vector3(0, 1.3, 0));
    expect(stage.pick(middle.x, middle.y)).toBe('f1');
    stage.setSample(samplePrevizScript(walking, 4));
    expect(stage.pick(middle.x, middle.y)).toBeNull();
    const end = toScreen(stage, new THREE.Vector3(2, 1.3, 0));
    expect(stage.pick(end.x, end.y)).toBe('f1');
  });

  it('名字标签：每次重绘回调人物头顶的位置', () => {
    const { stage } = setup();
    const listener = vi.fn<(labels: PrevizLabel[]) => void>();
    stage.onLabels(listener);
    const labels = listener.mock.calls[listener.mock.calls.length - 1][0];
    expect(labels.map((label) => label.id)).toEqual(['f1', 'f2']);
    expect(labels.every((label) => label.visible)).toBe(true);
    expect(labels[0].x).toBeLessThan(labels[1].x);
    expect(labels[0].y).toBeLessThan(250);
  });

  it('截图：只渲染取景框、长边 1280，隐藏网格与高亮，之后恢复', async () => {
    const { stage } = setup();
    stage.setHighlight('f1');
    expect(records[records.length - 1]).toMatchObject({ helpersVisible: true, viewOffset: false });
    expect(records[records.length - 1].emissive).not.toBe(0);
    records.length = 0;
    const size = captureSize(16 / 9);
    const png = await stage.capture(size);
    expect(Array.from(png)).toEqual([1, 2, 3]);
    expect(records[0]).toMatchObject({
      helpersVisible: false,
      viewOffset: true,
      ...size,
      emissive: 0,
    });
    const after = records[records.length - 1];
    expect(after).toMatchObject({ helpersVisible: true, viewOffset: false, width: 800 });
    expect(after.emissive).not.toBe(0);
    // 取景框视角 = 焦距视角：视口整体视角按取景框占比放大
    const rect = frameRect(800, 500, 16 / 9);
    const camera = (stage as unknown as { camera: THREE.PerspectiveCamera }).camera;
    const frameHalf = Math.tan((camera.fov * Math.PI) / 360) * (rect.height / 500);
    expect((Math.atan(frameHalf) * 360) / Math.PI).toBeCloseTo(
      (2 * Math.atan(36 / (16 / 9) / 2 / 35) * 180) / Math.PI,
      3
    );
  });

  it('逐帧导出：导出期间每帧只渲染取景框、不触发视口重绘；结束后恢复', () => {
    const { stage, canvas } = setup();
    records.length = 0;
    const size = captureSize(9 / 16);
    stage.beginExport(size);
    // 导出期间视口重绘（例如播放进度变化）不渲染到画布
    stage.setSample(samplePrevizScript(SCRIPT, 1));
    expect(records).toHaveLength(0);
    const frames = [0, 1, 2].map((index) =>
      stage.renderExportFrame(samplePrevizScript(SCRIPT, index / 24))
    );
    expect(frames.every((frame) => frame === canvas)).toBe(true);
    expect(records).toHaveLength(3);
    expect(records.every((record) => !record.helpersVisible && record.viewOffset)).toBe(true);
    expect(records[0]).toMatchObject(size);
    stage.endExport();
    expect(records[records.length - 1]).toMatchObject({
      helpersVisible: true,
      viewOffset: false,
      width: 800,
    });
  });

  it('换人物 / 道具 / 时段、释放都不报错', () => {
    const { stage } = setup();
    stage.setSample(samplePrevizScript({ ...SCRIPT, mood: 'night', figures: [], props: [] }, 0));
    stage.setSample(samplePrevizScript({ ...SCRIPT, mood: 'dusk' }, 0));
    const listener = vi.fn<(labels: PrevizLabel[]) => void>();
    stage.setSample(samplePrevizScript({ ...SCRIPT, figures: [] }, 0));
    stage.onLabels(listener);
    expect(listener).toHaveBeenLastCalledWith([]);
    expect(() => stage.dispose()).not.toThrow();
  });

  it('释放时不强制丢失 WebGL 上下文（StrictMode 会在同一个 canvas 上立即重建舞台）', () => {
    const { stage } = setup();
    contextLossCalls.count = 0;
    stage.dispose();
    expect(contextLossCalls.count).toBe(0);
  });
});
