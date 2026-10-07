/**
 * 3D 预演舞台接口：three.js 实现在 stage.ts（动态 import），测试可注入假实现。
 */
import type { MoodId, PrevizCameraView, PrevizFigure, PrevizProp } from './presets';

/** 人物名字标签在视口中的位置（CSS 像素，相对视口左上角）；DOM 叠加层，不进截图 */
export interface PrevizLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface PrevizStageApi {
  /** 视口尺寸（CSS 像素） */
  resize(width: number, height: number): void;
  /** 画幅宽高比：视口里居中的取景框，截图只取框内 */
  setFrame(aspect: number): void;
  setCamera(view: PrevizCameraView): void;
  setFigures(figures: readonly PrevizFigure[], selectedId: string | null): void;
  setProps(props: readonly PrevizProp[], selectedId: string | null): void;
  setMood(mood: MoodId): void;
  /** 每次重绘后回调名字标签位置 */
  onLabels(listener: (labels: PrevizLabel[]) => void): void;
  /** 屏幕坐标 → 地面坐标（拖动用） */
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null;
  /** 点中的人物或道具 id */
  pick(clientX: number, clientY: number): string | null;
  /** 按画幅截图（不含选中圈、网格等辅助元素） */
  capture(size: { width: number; height: number }): Promise<Uint8Array>;
  dispose(): void;
}

export type CreatePrevizStage = (canvas: HTMLCanvasElement) => Promise<PrevizStageApi>;
