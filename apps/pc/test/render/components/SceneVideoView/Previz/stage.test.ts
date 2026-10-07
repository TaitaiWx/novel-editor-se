// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  captureSize,
  defaultCameraView,
  defaultFigures,
  frameRect,
} from '@/render/components/SceneVideoView/Previz/presets';
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
      const marker = scene.children.find(
        (child) =>
          child.type === 'Group' &&
          child.children.some(
            (mesh) => mesh instanceof actual.Mesh && mesh.geometry.type === 'RingGeometry'
          )
      );
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
        helpersVisible: Boolean(grid?.visible) || Boolean(marker?.visible),
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

describe('PrevizStage（假渲染器）', () => {
  beforeEach(() => {
    records.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const canvas = makeCanvas();
    const stage = new PrevizStage(canvas);
    stage.resize(800, 500);
    stage.setFrame(16 / 9);
    stage.setCamera(defaultCameraView('全景'));
    stage.setFigures(defaultFigures(['林舟', '苏晴']), 'f1');
    stage.setProps([{ id: 'p1', kind: 'table', x: 0, z: -1.4, rotation: 0 }], 'f1');
    return { stage, canvas };
  }

  it('点选：射线命中人物与道具；点天空没有命中；地面拾取返回地面坐标', () => {
    const { stage } = setup();
    const chest = toScreen(stage, new THREE.Vector3(-0.45, 1.3, 0));
    expect(stage.pick(chest.x, chest.y)).toBe('f1');
    const other = toScreen(stage, new THREE.Vector3(0.45, 1.3, 0));
    expect(stage.pick(other.x, other.y)).toBe('f2');
    const table = toScreen(stage, new THREE.Vector3(0.3, 0.76, -1.4));
    expect(stage.pick(table.x, table.y)).toBe('p1');
    expect(stage.pick(400, 2)).toBeNull();
    const ground = toScreen(stage, new THREE.Vector3(1, 0, 0.5));
    const hit = stage.pickGround(ground.x, ground.y);
    expect(hit?.x).toBeCloseTo(1, 1);
    expect(hit?.z).toBeCloseTo(0.5, 1);
  });

  it('名字标签：每次重绘回调人物头顶的位置', () => {
    const { stage } = setup();
    const listener = vi.fn<(labels: PrevizLabel[]) => void>();
    stage.onLabels(listener);
    const labels = listener.mock.calls[listener.mock.calls.length - 1][0];
    expect(labels.map((label) => label.id)).toEqual(['f1', 'f2']);
    expect(labels.every((label) => label.visible)).toBe(true);
    // 林舟在左、苏晴在右，标签在画面上半部分
    expect(labels[0].x).toBeLessThan(labels[1].x);
    expect(labels[0].y).toBeLessThan(250);
  });

  it('截图：只渲染取景框、长边 1280，隐藏网格 / 选中标记 / 高亮，之后恢复', async () => {
    const { stage } = setup();
    expect(records[records.length - 1]).toMatchObject({ helpersVisible: true, viewOffset: false });
    expect(records[records.length - 1].emissive).not.toBe(0);
    records.length = 0;
    const size = captureSize(16 / 9);
    const png = await stage.capture(size);
    expect(Array.from(png)).toEqual([1, 2, 3]);
    const shot = records[0];
    expect(shot).toMatchObject({ helpersVisible: false, viewOffset: true, ...size, emissive: 0 });
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

  it('移除人物 / 道具、换时段、释放都不报错', () => {
    const { stage } = setup();
    stage.setMood('night');
    stage.setMood('dusk');
    stage.setFigures([], null);
    stage.setProps([], null);
    const listener = vi.fn<(labels: PrevizLabel[]) => void>();
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
