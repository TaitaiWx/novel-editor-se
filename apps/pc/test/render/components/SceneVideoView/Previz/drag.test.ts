import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PREVIZ_STAGE_LIMIT, defaultPrevizScript, samplePrevizScript } from '@novel-editor/video';
import {
  DRAG_THRESHOLD_PX,
  depthAlongView,
  dragDeltaOnGround,
  type DragBasis,
} from '@/render/components/SceneVideoView/Previz/drag';
import { frameRect, placementFromSample } from '@/render/components/SceneVideoView/Previz/presets';

const VIEW = { width: 900, height: 560 };
const ASPECT = 16 / 9;

/** 默认中景平视机位下（预演打开时的样子）人物胸口处的拖动基准 */
function eyeLevelBasis(): { basis: DragBasis; camera: THREE.PerspectiveCamera } {
  const script = defaultPrevizScript({ characters: ['A'], shotSize: 'medium', durationSec: 4 });
  const sample = samplePrevizScript(script, 4);
  const placement = placementFromSample(sample.camera, ASPECT);
  const rect = frameRect(VIEW.width, VIEW.height, ASPECT);
  const camera = new THREE.PerspectiveCamera(placement.fov, ASPECT, 0.05, 900);
  camera.position.set(...placement.position);
  camera.lookAt(new THREE.Vector3(...placement.target));
  camera.updateMatrixWorld();
  return {
    camera,
    basis: {
      yaw: sample.camera.yaw,
      elevation: sample.camera.elevation,
      depth: depthAlongView(placement, { x: 0, y: 1.2, z: 0 }),
      fov: placement.fov,
      frameHeight: rect.height,
    },
  };
}

/** 旧实现：鼠标射线与地面（y = 0）的交点 */
function groundHit(camera: THREE.PerspectiveCamera, ndcY: number): THREE.Vector3 | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, ndcY), camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

describe('拖动人物不会飞走（回归）', () => {
  it('根因：平视机位下，点在人物胸口附近时射线几乎贴着地面，一两个像素就让地面交点跳出几十米', () => {
    const { camera, basis } = eyeLevelBasis();
    // 胸口略低于画面中线（注视点约 1.33 米、胸口 1.2 米）
    const pxToNdc = 2 / basis.frameHeight;
    const a = groundHit(camera, -0.02);
    const b = groundHit(camera, -0.02 + 2 * pxToNdc);
    expect(a && b).toBeTruthy();
    // 旧实现：鼠标移动 2 像素，地面交点移动超过 10 米 → 被夹到舞台边缘、飞出画面
    expect(a!.distanceTo(b!)).toBeGreaterThan(10);
  });

  it('新实现：位移与鼠标位移成正比、跟手，平视时也有上限', () => {
    const { basis } = eyeLevelBasis();
    // 单击时的抖动（不足阈值）不改变站位
    expect(dragDeltaOnGround(basis, DRAG_THRESHOLD_PX - 1, 1)).toEqual({ dx: 0, dz: 0 });
    // 向右拖 100 像素：沿画面右方向移动，距离 = 人物深度处 100 像素对应的米数
    const right = dragDeltaOnGround(basis, 100, 0);
    const metersPerPx =
      (2 * basis.depth * Math.tan((basis.fov * Math.PI) / 360)) / basis.frameHeight;
    expect(right.dx).toBeCloseTo(100 * metersPerPx, 6);
    expect(Math.abs(right.dz)).toBeLessThan(1e-9);
    expect(right.dx).toBeLessThan(1);
    // 向上拖：推远（-z），平视时也是有限的距离
    const up = dragDeltaOnGround(basis, 0, -50);
    expect(up.dz).toBeLessThan(0);
    expect(Math.abs(up.dz)).toBeLessThan(1);
    // 每多拖 1 像素，位移只多一点点（不会突然跳远）
    for (let px = 5; px < 400; px += 1) {
      const before = dragDeltaOnGround(basis, px, -px / 2);
      const after = dragDeltaOnGround(basis, px + 1, -(px + 1) / 2);
      expect(Math.hypot(after.dx - before.dx, after.dz - before.dz)).toBeLessThan(0.05);
    }
  });

  it('机位绕到侧面：画面向右仍是相机右方向；位移总长不超过舞台宽度', () => {
    const { basis } = eyeLevelBasis();
    const side = dragDeltaOnGround({ ...basis, yaw: 90 }, 100, 0);
    // 相机在 +x 一侧看向原点，画面右方 = -z
    expect(side.dz).toBeLessThan(0);
    expect(Math.abs(side.dx)).toBeLessThan(1e-9);
    const huge = dragDeltaOnGround({ ...basis, depth: 1e6 }, 1e5, 1e5);
    expect(Math.hypot(huge.dx, huge.dz)).toBeLessThanOrEqual(PREVIZ_STAGE_LIMIT * 2 + 1e-9);
    const broken = dragDeltaOnGround({ ...basis, depth: Number.NaN }, 50, 0);
    expect(Number.isFinite(broken.dx)).toBe(true);
  });
});
