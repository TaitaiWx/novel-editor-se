// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createMotionLibrary,
  samplePrevizScript,
  validatePrevizScript,
  type PrevizScript,
} from '@novel-editor/video';
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

describe('木偶：动作片段 / 手部目标 / 绝对机位', () => {
  const clips = createMotionLibrary();

  it('挥手片段把右手举过头顶；淡出后回到站立姿势', () => {
    const wave = script({
      durationSec: 4,
      figures: [
        {
          name: 'A',
          keys: [
            { t: 0, x: 0, z: 0, pose: 'stand', motion: { clip: 'builtin:wave', loop: true } },
            { t: 3, x: 0, z: 0, pose: 'stand' },
          ],
        },
      ],
      camera: [{ t: 0, shotSize: 'full' }],
    });
    const mannequin = buildMannequin('#c9a27a');
    const pose = (t: number) => {
      applyPoseSample(mannequin, samplePrevizScript(wave, t, { clips }).figures[0]);
      mannequin.root.updateMatrixWorld(true);
      return {
        hand: world(mannequin.joints.rightHand).y,
        head: world(mannequin.joints.head).y,
      };
    };
    const raised = pose(1);
    expect(raised.hand).toBeGreaterThan(raised.head);
    const after = pose(3.5);
    expect(after.hand).toBeLessThan(1.1);
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
