// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { samplePrevizScript, validatePrevizScript, type PrevizScript } from '@novel-editor/video';
import { applyHandTargets } from '@/render/components/SceneVideoView/Previz/ik';
import {
  applyPoseSample,
  buildMannequin,
} from '@/render/components/SceneVideoView/Previz/mannequin';
import { placementFromSample } from '@/render/components/SceneVideoView/Previz/presets';

function script(raw: unknown): PrevizScript {
  const result = validatePrevizScript(raw);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.script;
}

const world = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3());

/** AI 写的关节轨迹：右大臂从侧面举过头顶，小臂左右摆（循环） */
const WAVE_TRACKS = {
  tracks: {
    rightUpperArm: [
      [0, 0, 0, -150],
      [0.4, 0, 0, -160],
      [0.8, 0, 0, -150],
    ],
    rightForearm: [
      [0, -20, 0, 25],
      [0.4, -20, 0, -25],
      [0.8, -20, 0, 25],
    ],
  },
  loop: true,
};

describe('木偶：AI 关节轨迹 / 手部目标 / 绝对机位', () => {
  it('挥手轨迹把右手举过头顶、小臂在摆；淡出后回到站立姿势', () => {
    const wave = script({
      durationSec: 4,
      figures: [
        {
          name: 'A',
          keys: [
            { t: 0, x: 0, z: 0, pose: 'stand', motion: WAVE_TRACKS },
            { t: 3, x: 0, z: 0, pose: 'stand' },
          ],
        },
      ],
      camera: [{ t: 0, shotSize: 'full' }],
    });
    const mannequin = buildMannequin('#c9a27a');
    const pose = (t: number) => {
      applyPoseSample(mannequin, samplePrevizScript(wave, t).figures[0]);
      mannequin.root.updateMatrixWorld(true);
      const hand = world(mannequin.joints.rightHand);
      return { hand: hand.y, handX: hand.x, head: world(mannequin.joints.head).y };
    };
    const raised = pose(1);
    expect(raised.hand).toBeGreaterThan(raised.head);
    // 小臂在摆：0.4 秒与 0.8 秒时手的左右位置明显不同
    expect(Math.abs(pose(0.4).handX - pose(0.8).handX)).toBeGreaterThan(0.08);
    const after = pose(3.5);
    expect(after.hand).toBeLessThan(1.1);
    // 行走 + 轨迹为 lean / rootBob：整体前倾、髋部下沉
    const lean = script({
      durationSec: 2,
      figures: [
        {
          name: 'A',
          keys: [
            {
              t: 0,
              x: 0,
              z: 0,
              pose: 'stand',
              motion: { tracks: {}, lean: [[0, 30]], rootBob: [[0, -0.2]] },
            },
          ],
        },
      ],
      camera: [{ t: 0, shotSize: 'full' }],
    });
    const bent = buildMannequin('#c9a27a');
    applyPoseSample(bent, samplePrevizScript(lean, 0.5).figures[0]);
    bent.root.updateMatrixWorld(true);
    expect(world(bent.joints.head).z).toBeGreaterThan(0.3);
    expect(bent.hips.position.y).toBeLessThan(0.8);
  });

  it('手部目标：手够到身前的点（两段臂 CCD）', () => {
    const reach = script({
      durationSec: 2,
      figures: [
        {
          name: 'A',
          keys: [
            { t: 0, x: 0, z: 0, pose: 'stand', hands: { right: { x: -0.25, y: 1.2, z: 0.45 } } },
          ],
        },
      ],
      camera: [{ t: 0, shotSize: 'full' }],
    });
    const mannequin = buildMannequin('#c9a27a');
    const figure = samplePrevizScript(reach, 0).figures[0];
    applyPoseSample(mannequin, figure);
    expect(applyHandTargets(mannequin, figure.hands)).toBe(true);
    mannequin.root.updateMatrixWorld(true);
    const hand = world(mannequin.joints.rightHand);
    expect(hand.distanceTo(new THREE.Vector3(-0.25, 1.2, 0.45))).toBeLessThan(0.03);
    // 没有目标时不改动
    expect(applyHandTargets(mannequin, undefined)).toBe(false);
  });

  it('绝对机位：权重 1 时相机就在给定位置，看向给定点', () => {
    const shot = script({
      durationSec: 2,
      figures: [{ name: 'A', keys: [{ t: 0, x: 0, z: 0, pose: 'stand' }] }],
      camera: [{ t: 0, shotSize: 'medium', position: [2, 1.5, 4], target: [0, 1.4, 0] }],
    });
    const placement = placementFromSample(samplePrevizScript(shot, 1).camera, 16 / 9);
    expect(placement.position).toEqual([2, 1.5, 4]);
    expect(placement.target).toEqual([0, 1.4, 0]);
  });
});
