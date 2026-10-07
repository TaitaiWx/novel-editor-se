/**
 * 3D 预演舞台接口：three.js 实现在 stage.ts（动态 import），测试可注入假实现。
 *
 * 舞台只渲染「某一时刻的采样」（@novel-editor/video samplePrevizScript 的结果）：
 * 播放、拖动进度条、逐帧导出视频都是先采样再 setSample / renderExportFrame，结果确定。
 */
import type { PrevizSample } from '@novel-editor/video';

/** 人物名字标签在视口中的位置（CSS 像素，相对视口左上角）；DOM 叠加层，不进截图 / 视频 */
export interface PrevizLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface PrevizStageApi {
  /** 视口尺寸（CSS 像素） */
  resize(width: number, height: number): void;
  /** 画幅宽高比：视口里居中的取景框，截图 / 视频只取框内 */
  setFrame(aspect: number): void;
  /** 显示某一时刻的画面 */
  setSample(sample: PrevizSample): void;
  /** 高亮正在拖动的人物（null 取消） */
  setHighlight(id: string | null): void;
  /** 每次重绘后回调名字标签位置 */
  onLabels(listener: (labels: PrevizLabel[]) => void): void;
  /** 点中的人物 id（道具不可拖动） */
  pick(clientX: number, clientY: number): string | null;
  /** 当前画面按画幅截图为 PNG（不含网格、高亮等辅助元素） */
  capture(size: { width: number; height: number }): Promise<Uint8Array>;
  /** 开始逐帧导出：切到导出尺寸、隐藏辅助元素 */
  beginExport(size: { width: number; height: number }): void;
  /** 渲染一帧并返回画布（交给 VideoFrame 编码） */
  renderExportFrame(sample: PrevizSample): CanvasImageSource;
  /** 结束导出，恢复视口尺寸与辅助元素 */
  endExport(): void;
  dispose(): void;
}

export type CreatePrevizStage = (canvas: HTMLCanvasElement) => Promise<PrevizStageApi>;
