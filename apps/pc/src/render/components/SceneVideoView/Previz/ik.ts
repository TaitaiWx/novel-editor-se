/**
 * 手部目标（简易 IK）：预演脚本关键帧的 hands.left / hands.right 是手要够到的世界坐标点（米）。
 * 对上臂 + 前臂做几轮 CCD（循环坐标下降）：每根骨头转向「末端 → 目标」，够不到时手臂伸直指向目标。
 * 按权重在原姿势与解算结果之间球面插值，关键帧之间自然过渡。
 */
import * as THREE from 'three';
import type { PrevizFigureSample } from '@novel-editor/video';
import type { Mannequin } from './mannequin';

const ITERATIONS = 8;
const bonePos = new THREE.Vector3();
const effectorPos = new THREE.Vector3();
const targetPos = new THREE.Vector3();
const toEffector = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const delta = new THREE.Quaternion();
const boneWorld = new THREE.Quaternion();
const parentWorld = new THREE.Quaternion();

function rotateToward(bone: THREE.Object3D, effector: THREE.Object3D, target: THREE.Vector3) {
  bone.getWorldPosition(bonePos);
  effector.getWorldPosition(effectorPos);
  toEffector.subVectors(effectorPos, bonePos);
  toTarget.subVectors(target, bonePos);
  if (toEffector.lengthSq() < 1e-8 || toTarget.lengthSq() < 1e-8) return;
  delta.setFromUnitVectors(toEffector.normalize(), toTarget.normalize());
  bone.getWorldQuaternion(boneWorld);
  bone.parent?.getWorldQuaternion(parentWorld);
  // 新的世界朝向 = delta · 原世界朝向；换回父关节坐标
  boneWorld.premultiply(delta);
  bone.quaternion.copy(parentWorld.invert().multiply(boneWorld));
  bone.updateMatrixWorld(true);
}

/** 两段臂解算，返回是否改动了姿势 */
export function applyHandTargets(
  mannequin: Mannequin,
  hands: PrevizFigureSample['hands'] | undefined
): boolean {
  if (!hands) return false;
  let changed = false;
  mannequin.root.updateMatrixWorld(true);
  for (const side of ['left', 'right'] as const) {
    const target = hands[side];
    if (!target || !(target.weight > 0)) continue;
    const upper = mannequin.joints[side === 'left' ? 'leftUpperArm' : 'rightUpperArm'];
    const fore = mannequin.joints[side === 'left' ? 'leftForearm' : 'rightForearm'];
    const hand = mannequin.joints[side === 'left' ? 'leftHand' : 'rightHand'];
    const originalUpper = upper.quaternion.clone();
    const originalFore = fore.quaternion.clone();
    targetPos.set(target.x, target.y, target.z);
    for (let i = 0; i < ITERATIONS; i += 1) {
      rotateToward(fore, hand, targetPos);
      rotateToward(upper, hand, targetPos);
    }
    const weight = Math.min(1, target.weight);
    if (weight < 1) {
      upper.quaternion.copy(originalUpper.slerp(upper.quaternion, weight));
      fore.quaternion.copy(originalFore.slerp(fore.quaternion, weight));
      upper.updateMatrixWorld(true);
    }
    changed = true;
  }
  return changed;
}
