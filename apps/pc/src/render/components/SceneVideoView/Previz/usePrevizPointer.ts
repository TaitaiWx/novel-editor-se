/**
 * 预演视口的鼠标操作：
 * - 按住人物 / 道具拖动 → 在地面上移动（保持按下时的相对位置，不会跳到鼠标下）
 * - 按住 Shift（或 Alt）拖动人物 / 道具 → 左右拖动旋转朝向
 * - 拖动空白处 → 转动机位（左右环绕、上下改俯仰）
 */
import { useRef, useState } from 'react';
import type React from 'react';
import type { PrevizScene } from './usePrevizScene';
import type { PrevizStageApi } from './types';

type Drag =
  | { mode: 'move'; id: string; offsetX: number; offsetZ: number }
  | { mode: 'rotate'; id: string; startX: number; startRotation: number }
  | { mode: 'orbit'; startX: number; startY: number; startYaw: number; startPitch: number };

/** 拖动多少像素转一度（机位环绕 / 俯仰、人物旋转） */
const ORBIT_DEG_PER_PX = 0.3;
const PITCH_DEG_PER_PX = 0.2;
const ROTATE_RAD_PER_PX = 0.012;

export function usePrevizPointer(
  stageRef: React.RefObject<PrevizStageApi | null>,
  scene: PrevizScene
) {
  const dragRef = useRef<Drag | null>(null);
  const [orbiting, setOrbiting] = useState(false);

  const positionOf = (id: string) =>
    scene.figures.find((figure) => figure.id === id) ??
    scene.props.find((prop) => prop.id === id) ??
    null;

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const stage = stageRef.current;
    if (!stage || event.button > 0) return;
    const id = stage.pick(event.clientX, event.clientY);
    const item = id ? positionOf(id) : null;
    if (id && item) {
      scene.setSelectedId(id);
      if (event.shiftKey || event.altKey) {
        dragRef.current = {
          mode: 'rotate',
          id,
          startX: event.clientX,
          startRotation: item.rotation,
        };
      } else {
        const ground = stage.pickGround(event.clientX, event.clientY);
        dragRef.current = {
          mode: 'move',
          id,
          offsetX: ground ? item.x - ground.x : 0,
          offsetZ: ground ? item.z - ground.z : 0,
        };
      }
    } else {
      dragRef.current = {
        mode: 'orbit',
        startX: event.clientX,
        startY: event.clientY,
        startYaw: scene.view.yaw,
        startPitch: scene.view.pitch,
      };
      setOrbiting(true);
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    if (drag.mode === 'move') {
      const point = stage.pickGround(event.clientX, event.clientY);
      if (point) scene.moveItem(drag.id, point.x + drag.offsetX, point.z + drag.offsetZ);
    } else if (drag.mode === 'rotate') {
      scene.setRotation(
        drag.id,
        drag.startRotation + (event.clientX - drag.startX) * ROTATE_RAD_PER_PX
      );
    } else {
      scene.camera.setYaw(drag.startYaw - (event.clientX - drag.startX) * ORBIT_DEG_PER_PX);
      scene.camera.setPitch(drag.startPitch + (event.clientY - drag.startY) * PITCH_DEG_PER_PX);
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    dragRef.current = null;
    setOrbiting(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, orbiting };
}
