/**
 * 预演视口的鼠标微调（只改脚本，不另存状态）：
 * - 按住人物拖动 → 整段走位一起平移（translateFigureTrack），位移按人物深度换算（drag.ts，不会飞走）
 * - 拖动空白处 → 所有机位关键帧一起环绕（orbitScriptCamera）
 * 每次拖动都基于按下时的脚本计算总位移，不累积误差；移动不足几个像素视为单击。
 */
import { useRef, useState } from 'react';
import type React from 'react';
import {
  orbitScriptCamera,
  pinCameraFocus,
  samplePrevizScript,
  translateFigureTrack,
  type PrevizScript,
} from '@novel-editor/video';
import { DRAG_THRESHOLD_PX, ORBIT_DEG_PER_PX, depthAlongView, dragDeltaOnGround } from './drag';
import { frameRect, placementFromSample } from './presets';
import type { PrevizStageApi } from './types';

type Drag =
  | { mode: 'move'; id: string; startX: number; startY: number; base: PrevizScript; moved: boolean }
  | { mode: 'orbit'; startX: number; startY: number; base: PrevizScript; moved: boolean };

export interface PrevizPointerOptions {
  stageRef: React.RefObject<PrevizStageApi | null>;
  script: PrevizScript;
  time: number;
  aspect: number;
  /** 视口尺寸（CSS 像素） */
  size: { width: number; height: number };
  /** 拖动中实时改脚本 */
  onChange: (script: PrevizScript) => void;
  disabled?: boolean;
}

/** 胸口高度：深度按人物胸口计算 */
const CHEST_HEIGHT = 1.2;

export function usePrevizPointer({
  stageRef,
  script,
  time,
  aspect,
  size,
  onChange,
  disabled,
}: PrevizPointerOptions) {
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<'move' | 'orbit' | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const stage = stageRef.current;
    if (!stage || disabled || event.button > 0) return;
    const id = stage.pick(event.clientX, event.clientY);
    const start = { startX: event.clientX, startY: event.clientY, base: script, moved: false };
    if (id && script.figures.some((track) => track.id === id)) {
      // 机位固定在当前人物中心，拖动时人物在画面里跟手移动
      dragRef.current = { mode: 'move', id, ...start, base: pinCameraFocus(script) };
      stage.setHighlight(id);
      setDragging('move');
    } else {
      dragRef.current = { mode: 'orbit', ...start };
      setDragging('orbit');
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = event.clientX - drag.startX;
    const dyPx = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    if (drag.mode === 'orbit') {
      onChange(orbitScriptCamera(drag.base, -dxPx * ORBIT_DEG_PER_PX));
      return;
    }
    const sample = samplePrevizScript(drag.base, time);
    const figure = sample.figures.find((item) => item.id === drag.id);
    if (!figure) return;
    const placement = placementFromSample(sample.camera, aspect);
    const delta = dragDeltaOnGround(
      {
        yaw: sample.camera.yaw,
        elevation: sample.camera.elevation,
        depth: depthAlongView(placement, { x: figure.x, y: CHEST_HEIGHT, z: figure.z }),
        fov: placement.fov,
        frameHeight: frameRect(size.width, size.height, aspect).height,
      },
      dxPx,
      dyPx
    );
    onChange(translateFigureTrack(drag.base, drag.id, delta.dx, delta.dz));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.mode === 'move') stageRef.current?.setHighlight(null);
    dragRef.current = null;
    setDragging(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, dragging };
}
