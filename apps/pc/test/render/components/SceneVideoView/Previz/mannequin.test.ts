// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PREVIZ_PROP_DEFAULT_SIZE } from '@novel-editor/video';
import {
  applyPose,
  applyPoseSample,
  buildMannequin,
  disposeMannequin,
  setMannequinSelected,
  type Mannequin,
} from '@/render/components/SceneVideoView/Previz/mannequin';
import {
  buildProp,
  disposeProp,
  setPropSelected,
} from '@/render/components/SceneVideoView/Previz/propMeshes';
import {
  POSE_PRESETS,
  PROP_PRESETS,
  defaultFigures,
  type PrevizFigure,
} from '@/render/components/SceneVideoView/Previz/presets';

function posed(pose: string, extra: Partial<PrevizFigure> = {}): Mannequin {
  const mannequin = buildMannequin('#c9a27a');
  applyPose(mannequin, { ...defaultFigures(['林舟'])[0], pose, ...extra });
  mannequin.root.updateMatrixWorld(true);
  return mannequin;
}

/** 按顶点算的精确包围盒（椭球旋转后 Box3.expandByObject 偏保守） */
function bounds(mannequin: Mannequin): THREE.Box3 {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const mesh of mannequin.meshes) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    }
  }
  return box;
}

const world = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3());

describe('木偶小人', () => {
  it('每个姿势都「落地」：最低点贴着地面，不悬空也不陷进地里', () => {
    for (const pose of POSE_PRESETS) {
      const box = bounds(posed(pose.id));
      expect(box.min.y, pose.id).toBeGreaterThan(-0.035);
      expect(box.min.y, pose.id).toBeLessThan(0.035);
    }
  });

  it('站立身高约 1.75–1.8 米；坐 / 蹲 / 跪更矮，倒地贴近地面', () => {
    const stand = bounds(posed('stand')).max.y;
    expect(stand).toBeGreaterThan(1.72);
    expect(stand).toBeLessThan(1.82);
    for (const id of ['sit', 'crouch', 'kneel']) {
      const height = bounds(posed(id)).max.y;
      expect(height, id).toBeLessThan(1.4);
      expect(height, id).toBeGreaterThan(1);
    }
    expect(bounds(posed('fallen')).max.y).toBeLessThan(0.45);
  });

  it('坐姿的髋部在椅面高度附近（椅面约 0.45 米）', () => {
    const hips = world(posed('sit').hips);
    expect(hips.y).toBeGreaterThan(0.45);
    expect(hips.y).toBeLessThan(0.56);
  });

  it('面向 +Z：鼻尖在头部前方；头部转向让脸转向侧面', () => {
    const front = posed('stand');
    const head = world(front.joints.head);
    const anchor = world(front.labelAnchor);
    expect(anchor.y).toBeGreaterThan(1.85);
    const noseZ = (mannequin: Mannequin) => {
      const nose = mannequin.meshes.find((mesh) => mesh.geometry.type === 'ConeGeometry');
      return world(nose as THREE.Mesh);
    };
    expect(noseZ(front).z).toBeGreaterThan(head.z + 0.08);
    const turned = noseZ(posed('stand', { headTurn: 80 }));
    expect(turned.x).toBeGreaterThan(0.08);
    expect(turned.z).toBeLessThan(noseZ(front).z);
  });

  it('指向：右手伸到身前、约肩高；抬右手微调把手举过头顶', () => {
    const point = world(posed('point').joints.rightHand);
    expect(point.z).toBeGreaterThan(0.45);
    expect(point.y).toBeGreaterThan(1.25);
    expect(point.y).toBeLessThan(1.6);
    const raised = world(posed('stand', { armRaise: 170 }).joints.rightHand);
    expect(raised.y).toBeGreaterThan(1.8);
  });

  it('拥抱：双手在身前并向内合拢', () => {
    const mannequin = posed('embrace');
    const left = world(mannequin.joints.leftHand);
    const right = world(mannequin.joints.rightHand);
    expect(left.z).toBeGreaterThan(0.3);
    expect(right.z).toBeGreaterThan(0.3);
    expect(Math.abs(left.x - right.x)).toBeLessThan(0.3);
  });

  it('姿势混合：站→坐过渡中髋部在两者之间；行走步态让双腿前后交替', () => {
    const at = (mix: number) => {
      const mannequin = buildMannequin('#c9a27a');
      applyPoseSample(mannequin, {
        poseFrom: 'stand',
        poseTo: 'sit',
        mix,
        joints: {},
        gait: { phase: 0, walk: 0, run: 0 },
      });
      return mannequin.hips.position.y;
    };
    expect(at(0.5)).toBeLessThan(at(0));
    expect(at(0.5)).toBeGreaterThan(at(1));
    const walking = (phase: number) => {
      const mannequin = buildMannequin('#c9a27a');
      applyPoseSample(mannequin, {
        poseFrom: 'walk',
        poseTo: 'walk',
        mix: 0,
        joints: { head: [0, 30, 0] },
        gait: { phase, walk: 1, run: 0 },
      });
      return mannequin;
    };
    const a = walking(Math.PI / 2);
    const b = walking((Math.PI * 3) / 2);
    expect(a.joints.leftThigh.rotation.x).toBeLessThan(0);
    expect(b.joints.leftThigh.rotation.x).toBeGreaterThan(0);
    expect(a.joints.head.rotation.y).toBeCloseTo((30 * Math.PI) / 180, 5);
  });

  it('选中时整体带一点高亮，取消后恢复；释放不报错', () => {
    const mannequin = posed('stand');
    setMannequinSelected(mannequin, true);
    expect(mannequin.materials.wood.emissive.getHex()).not.toBe(0);
    setMannequinSelected(mannequin, false);
    expect(mannequin.materials.wood.emissive.getHex()).toBe(0);
    expect(() => disposeMannequin(mannequin)).not.toThrow();
  });

  it('每种道具都能生成、落在地面上，可高亮与释放', () => {
    for (const preset of PROP_PRESETS) {
      const prop = buildProp(preset.kind);
      prop.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(prop.root);
      expect(box.min.y, preset.kind).toBeGreaterThanOrEqual(-0.001);
      // 高度与预演脚本的默认尺寸一致（size 按它缩放）
      const height = PREVIZ_PROP_DEFAULT_SIZE[preset.kind][1];
      expect(Math.abs(box.max.y - height) / height, preset.kind).toBeLessThan(0.1);
      setPropSelected(prop, true);
      expect(prop.materials[0].emissive.getHex()).not.toBe(0);
      setPropSelected(prop, false);
      expect(() => disposeProp(prop)).not.toThrow();
    }
  });
});
