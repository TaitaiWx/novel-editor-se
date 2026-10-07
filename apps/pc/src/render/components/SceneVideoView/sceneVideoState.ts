/**
 * 场景视频工作区状态（保存为 <作品>/资料/视频/<章>/<场景>/分镜.json）与相关纯函数：
 * 镜头编号、版本列表、费用预估文案、视频提示词、章纲回链。
 *
 * 镜头编号：镜头 id 固定为 shot-<N>，N 只增不减（nextShotNumber），成片文件名 镜头N-vX.mp4 用的就是 N，
 * 因此作者调整顺序、删除镜头、重新生成分镜后，已生成的成片仍然对应原来的镜头，不会串号。
 */
import { isSafeMediaPath } from '@novel-editor/core/entity-media';
import {
  ASPECT_RATIOS,
  STORYBOARD_MAX_SHOTS,
  parseShotFileName,
  validatePrevizScript,
  validateStoryboard,
  type AspectRatio,
  type PrevizScript,
  type Shot,
  type Storyboard,
} from '@novel-editor/video';

export const SCENE_VIDEO_STATE_SCHEMA = 1;
export const SCENE_VIDEO_STYLES = ['写实', '国漫', '水墨', '电影感'] as const;
export const SCENE_SHOT_DURATIONS = [4, 6, 8, 10] as const;
export const DEFAULT_SHOT_DURATION = 6;

export interface SceneVideoState {
  schemaVersion: typeof SCENE_VIDEO_STATE_SCHEMA;
  /** 章节文件绝对路径 */
  chapterPath: string;
  /** 章节名（落盘目录名，来自文件名） */
  chapter: string;
  scene: string;
  sourceText: string;
  location: string;
  characters: string[];
  style: string;
  aspectRatio: AspectRatio;
  shotDurationSec: number;
  /** 视频服务（未配置时为 null） */
  providerId: string | null;
  model?: string;
  /** 用人物头像作首帧参考（模型支持时） */
  useAvatarReference: boolean;
  /** 生成与画面同步的声音（只对支持的视频服务生效，例如 Seedance；默认开启，成片保留声音） */
  withAudio: boolean;
  storyboard: Storyboard;
  nextShotNumber: number;
  selectedShotIds: string[];
  /** 每个镜头选用的成片文件名（拼接样片 / 回链章纲使用） */
  chosenVersions: Record<string, string>;
  /** 画布上作者拖动过的节点位置（未拖动的节点自动排布） */
  canvas: SceneCanvasState;
  /** 镜头 id → 采用的首帧图（相对作品目录）；生成视频时作为首帧 */
  keyframes: Record<string, string>;
  /** 镜头 id → 预演第一帧（3D 预演，相对作品目录）；生成首帧时作为构图参考 */
  previz: Record<string, string>;
  /** 镜头 id → 预演视频（3D 预演逐帧导出的 MP4，相对作品目录）；作者的动作参考 */
  previzVideo: Record<string, string>;
  /** 镜头 id → 预演脚本（AI 生成 + 作者微调；重新打开预演时恢复） */
  previzScripts: Record<string, PrevizScript>;
  /** 最近一次自动合成样片时各镜头选用的版本签名（未变化时不重复合成） */
  animaticSignature?: string;
  /** 已自动在本章章纲里记录这一场的视频（只记录一次） */
  outlineLinked?: boolean;
  updatedAt: string;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface SceneCanvasState {
  positions: Record<string, CanvasPoint>;
}

export interface CreateSceneStateInput {
  chapterPath: string;
  chapter: string;
  scene: string;
  sourceText: string;
  location?: string;
  characters?: string[];
}

export function createSceneVideoState(input: CreateSceneStateInput, now: Date): SceneVideoState {
  return {
    schemaVersion: SCENE_VIDEO_STATE_SCHEMA,
    chapterPath: input.chapterPath,
    chapter: input.chapter,
    scene: input.scene,
    sourceText: input.sourceText,
    location: input.location ?? '',
    characters: input.characters ?? [],
    style: SCENE_VIDEO_STYLES[0],
    aspectRatio: '16:9',
    shotDurationSec: DEFAULT_SHOT_DURATION,
    providerId: null,
    useAvatarReference: false,
    withAudio: true,
    storyboard: { version: 1, aspectRatio: '16:9', shots: [] },
    nextShotNumber: 1,
    selectedShotIds: [],
    chosenVersions: {},
    canvas: { positions: {} },
    keyframes: {},
    previz: {},
    previzVideo: {},
    previzScripts: {},
    updatedAt: now.toISOString(),
  };
}

/** 镜头 id → 预演脚本：只保留存在的镜头，脚本重新校验（数值夹到安全范围） */
function parsePrevizScripts(raw: unknown, ids: ReadonlySet<string>): Record<string, PrevizScript> {
  const result: Record<string, PrevizScript> = {};
  if (!isRecord(raw)) return result;
  for (const [id, value] of Object.entries(raw)) {
    if (!ids.has(id)) continue;
    const validation = validatePrevizScript(value);
    if (validation.ok) result[id] = validation.script;
  }
  return result;
}

/** 镜头 id → 相对路径的映射：只保留存在的镜头与安全的相对路径 */
function parseShotImageMap(raw: unknown, ids: ReadonlySet<string>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(raw)) return result;
  for (const [id, value] of Object.entries(raw)) {
    if (!ids.has(id) || typeof value !== 'string') continue;
    const path = value.trim();
    if (isSafeMediaPath(path)) result[id] = path;
  }
  return result;
}

const CANVAS_COORD_LIMIT = 100_000;

/** 画布位置：只保留有限数值，丢弃无效项 */
export function parseCanvasState(raw: unknown): SceneCanvasState {
  const positions: Record<string, CanvasPoint> = {};
  const source = isRecord(raw) && isRecord(raw.positions) ? raw.positions : {};
  for (const [id, point] of Object.entries(source)) {
    if (!isRecord(point)) continue;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Math.abs(x) > CANVAS_COORD_LIMIT || Math.abs(y) > CANVAS_COORD_LIMIT) continue;
    positions[id] = { x: Math.round(x), y: Math.round(y) };
  }
  return { positions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 镜头编号：shot-12 → 12；不是该格式时返回 null */
export function shotNumber(shot: Pick<Shot, 'id'>): number | null {
  const match = /^shot-(\d+)$/.exec(shot.id);
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 给镜头重新分配 shot-<N>（从 start 开始），返回新镜头与下一个编号 */
export function renumberShots(
  shots: readonly Shot[],
  start: number
): { shots: Shot[]; next: number } {
  let next = Math.max(1, Math.floor(start));
  const result = shots.map((shot) => ({ ...shot, id: `shot-${next++}` }));
  return { shots: result, next };
}

/**
 * 读取 分镜.json：结构不对时返回 null（当作没有保存过），字段缺失时补默认值；
 * 分镜部分复用 validateStoryboard，id 不是 shot-<N> 的镜头重新编号
 */
export function parseSceneVideoState(raw: unknown): SceneVideoState | null {
  if (!isRecord(raw) || raw.schemaVersion !== SCENE_VIDEO_STATE_SCHEMA) return null;
  const chapter = str(raw.chapter).trim();
  const scene = str(raw.scene).trim();
  if (!chapter || !scene) return null;
  const rawBoard = isRecord(raw.storyboard) ? raw.storyboard : { shots: [] };
  const rawShots = Array.isArray(rawBoard.shots) ? rawBoard.shots : [];
  let shots: Shot[] = [];
  let aspectRatio: AspectRatio = '16:9';
  if (rawShots.length > 0) {
    // 作者新增后还没填写的镜头允许画面描述为空：校验时先补占位，校验后还原
    const blank = rawShots.map((item) => !isRecord(item) || !str(item.description).trim());
    const validation = validateStoryboard({
      ...rawBoard,
      shots: rawShots.map((item, index) =>
        blank[index] && isRecord(item) ? { ...item, description: '待补充' } : item
      ),
    });
    if (!validation.ok) return null;
    shots = validation.storyboard.shots.map((shot, index) =>
      blank[index] ? { ...shot, description: '' } : shot
    );
    aspectRatio = validation.storyboard.aspectRatio;
  } else if (ASPECT_RATIOS.includes(rawBoard.aspectRatio as AspectRatio)) {
    aspectRatio = rawBoard.aspectRatio as AspectRatio;
  }
  let nextShotNumber = Number(raw.nextShotNumber);
  if (!Number.isSafeInteger(nextShotNumber) || nextShotNumber < 1) nextShotNumber = 1;
  const maxUsed = Math.max(0, ...shots.map((shot) => shotNumber(shot) ?? 0));
  nextShotNumber = Math.max(nextShotNumber, maxUsed + 1);
  if (shots.some((shot) => shotNumber(shot) === null)) {
    const renumbered = renumberShots(shots, nextShotNumber);
    shots = renumbered.shots;
    nextShotNumber = renumbered.next;
  }
  const ids = new Set(shots.map((shot) => shot.id));
  const chosen: Record<string, string> = {};
  if (isRecord(raw.chosenVersions)) {
    for (const [id, file] of Object.entries(raw.chosenVersions)) {
      if (ids.has(id) && typeof file === 'string' && parseShotFileName(file)) chosen[id] = file;
    }
  }
  const ratio = ASPECT_RATIOS.includes(raw.aspectRatio as AspectRatio)
    ? (raw.aspectRatio as AspectRatio)
    : aspectRatio;
  const duration = Number(raw.shotDurationSec);
  const state: SceneVideoState = {
    schemaVersion: SCENE_VIDEO_STATE_SCHEMA,
    chapterPath: str(raw.chapterPath),
    chapter,
    scene,
    sourceText: str(raw.sourceText),
    location: str(raw.location),
    characters: Array.isArray(raw.characters)
      ? raw.characters.filter((item): item is string => typeof item === 'string')
      : [],
    style: str(raw.style, SCENE_VIDEO_STYLES[0]) || SCENE_VIDEO_STYLES[0],
    aspectRatio: ratio,
    shotDurationSec:
      Number.isFinite(duration) && duration >= 1 && duration <= 15
        ? duration
        : DEFAULT_SHOT_DURATION,
    providerId: typeof raw.providerId === 'string' && raw.providerId ? raw.providerId : null,
    useAvatarReference: raw.useAvatarReference === true,
    withAudio: raw.withAudio !== false,
    storyboard: { version: 1, aspectRatio: ratio, shots },
    nextShotNumber,
    selectedShotIds: Array.isArray(raw.selectedShotIds)
      ? raw.selectedShotIds.filter((id): id is string => typeof id === 'string' && ids.has(id))
      : [],
    chosenVersions: chosen,
    canvas: parseCanvasState(raw.canvas),
    keyframes: parseShotImageMap(raw.keyframes, ids),
    previz: parseShotImageMap(raw.previz, ids),
    previzVideo: parseShotImageMap(raw.previzVideo, ids),
    previzScripts: parsePrevizScripts(raw.previzScripts, ids),
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
  if (typeof raw.model === 'string' && raw.model) state.model = raw.model;
  if (typeof raw.animaticSignature === 'string') state.animaticSignature = raw.animaticSignature;
  if (raw.outlineLinked === true) state.outlineLinked = true;
  const style = str(rawBoard.style);
  if (style) state.storyboard.style = style;
  return state;
}

/** 用新分镜替换当前分镜（AI / 兜底拆分）：重新编号，默认全部选中，清空已选版本 */
export function replaceStoryboardShots(state: SceneVideoState, shots: Shot[]): SceneVideoState {
  const renumbered = renumberShots(shots.slice(0, STORYBOARD_MAX_SHOTS), state.nextShotNumber);
  // 旧镜头在画布上的位置作废（场景 / 人物 / 样片节点的位置保留）
  const positions = Object.fromEntries(
    Object.entries(state.canvas.positions).filter(([id]) => shotNumber({ id }) === null)
  );
  return {
    ...state,
    canvas: { ...state.canvas, positions },
    keyframes: {},
    previz: {},
    previzVideo: {},
    previzScripts: {},
    storyboard: { ...state.storyboard, shots: renumbered.shots },
    nextShotNumber: renumbered.next,
    selectedShotIds: renumbered.shots.map((shot) => shot.id),
    chosenVersions: {},
  };
}

/** 新增一个空白镜头（追加到末尾并选中） */
export function appendShot(state: SceneVideoState): SceneVideoState {
  if (state.storyboard.shots.length >= STORYBOARD_MAX_SHOTS) return state;
  const shot: Shot = {
    id: `shot-${state.nextShotNumber}`,
    shotSize: '中景',
    durationSec: state.shotDurationSec,
    description: '',
  };
  return {
    ...state,
    storyboard: { ...state.storyboard, shots: [...state.storyboard.shots, shot] },
    nextShotNumber: state.nextShotNumber + 1,
    selectedShotIds: [...state.selectedShotIds, shot.id],
  };
}

export function removeShot(state: SceneVideoState, id: string): SceneVideoState {
  const chosen = { ...state.chosenVersions };
  delete chosen[id];
  const positions = { ...state.canvas.positions };
  delete positions[id];
  const keyframes = { ...state.keyframes };
  delete keyframes[id];
  const previz = { ...state.previz };
  delete previz[id];
  const previzVideo = { ...state.previzVideo };
  delete previzVideo[id];
  const previzScripts = { ...state.previzScripts };
  delete previzScripts[id];
  return {
    ...state,
    canvas: { ...state.canvas, positions },
    keyframes,
    previz,
    previzVideo,
    previzScripts,
    storyboard: {
      ...state.storyboard,
      shots: state.storyboard.shots.filter((shot) => shot.id !== id),
    },
    selectedShotIds: state.selectedShotIds.filter((item) => item !== id),
    chosenVersions: chosen,
  };
}

/** 拖动排序：把 fromId 移到 toId 的位置 */
export function moveShot(shots: readonly Shot[], fromId: string, toId: string): Shot[] {
  const from = shots.findIndex((shot) => shot.id === fromId);
  const to = shots.findIndex((shot) => shot.id === toId);
  if (from < 0 || to < 0 || from === to) return [...shots];
  const next = [...shots];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function updateShot(
  state: SceneVideoState,
  id: string,
  patch: Partial<Omit<Shot, 'id'>>
): SceneVideoState {
  return {
    ...state,
    storyboard: {
      ...state.storyboard,
      shots: state.storyboard.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
    },
  };
}

/** 导出 Markdown 分镜表用的分镜（带上界面上选的比例与风格） */
export function storyboardForExport(state: SceneVideoState): Storyboard {
  return {
    ...state.storyboard,
    title: `${state.chapter} · ${state.scene}`,
    aspectRatio: state.aspectRatio,
    style: state.style || undefined,
  };
}

// 派生计算（路径 / 任务 / 费用 / 提示词 / 自动化）拆在 sceneVideoDerived.ts，这里统一再导出
export * from './sceneVideoDerived';
