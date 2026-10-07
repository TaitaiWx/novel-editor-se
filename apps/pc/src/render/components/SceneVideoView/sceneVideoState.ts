/**
 * 场景视频工作区状态（保存为 <作品>/资料/视频/<章>/<场景>/分镜.json）与相关纯函数：
 * 镜头编号、版本列表、费用预估文案、视频提示词、章纲回链。
 *
 * 镜头编号：镜头 id 固定为 shot-<N>，N 只增不减（nextShotNumber），成片文件名 镜头N-vX.mp4 用的就是 N，
 * 因此作者调整顺序、删除镜头、重新生成分镜后，已生成的成片仍然对应原来的镜头，不会串号。
 */
import {
  ASPECT_RATIOS,
  STORYBOARD_MAX_SHOTS,
  formatMoney,
  isAnimaticFileName,
  parseShotFileName,
  perSecondEstimator,
  storyboardDurationSec,
  validateStoryboard,
  videoSceneLayout,
  type AspectRatio,
  type CostCurrency,
  type Shot,
  type Storyboard,
  type VideoTask,
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
  storyboard: Storyboard;
  nextShotNumber: number;
  selectedShotIds: string[];
  /** 每个镜头选用的成片文件名（拼接样片 / 回链章纲使用） */
  chosenVersions: Record<string, string>;
  updatedAt: string;
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
    storyboard: { version: 1, aspectRatio: '16:9', shots: [] },
    nextShotNumber: 1,
    selectedShotIds: [],
    chosenVersions: {},
    updatedAt: now.toISOString(),
  };
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
    storyboard: { version: 1, aspectRatio: ratio, shots },
    nextShotNumber,
    selectedShotIds: Array.isArray(raw.selectedShotIds)
      ? raw.selectedShotIds.filter((id): id is string => typeof id === 'string' && ids.has(id))
      : [],
    chosenVersions: chosen,
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
  if (typeof raw.model === 'string' && raw.model) state.model = raw.model;
  const style = str(rawBoard.style);
  if (style) state.storyboard.style = style;
  return state;
}

/** 用新分镜替换当前分镜（AI / 兜底拆分）：重新编号，默认全部选中，清空已选版本 */
export function replaceStoryboardShots(state: SceneVideoState, shots: Shot[]): SceneVideoState {
  const renumbered = renumberShots(shots.slice(0, STORYBOARD_MAX_SHOTS), state.nextShotNumber);
  return {
    ...state,
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
  return {
    ...state,
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

// ─── 路径与版本 ─────────────────────────────────────────────────────────

/** 章节名：文件名去掉扩展名（001-启程.md → 001-启程） */
export function chapterNameFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.[^.]+$/, '') || base;
}

/** 场景目录（相对作品目录，与主进程落盘一致） */
export function sceneRelativeDir(chapter: string, scene: string): string {
  return videoSceneLayout({ chapter, scene }).dir;
}

export interface ShotVersion {
  version: number;
  fileName: string;
}

/** 目录中某镜头已下载的成片版本（新版本在前） */
export function shotVersionsFromFiles(files: readonly string[], number: number): ShotVersion[] {
  return files
    .map((fileName) => ({ fileName, parsed: parseShotFileName(fileName) }))
    .filter((item) => item.parsed && item.parsed.shotIndex === number)
    .map((item) => ({ fileName: item.fileName, version: item.parsed?.version ?? 0 }))
    .sort((a, b) => b.version - a.version);
}

/** 目录中的拼接样片（新文件在前；文件名带时间戳，按名称倒序即可） */
export function animaticFiles(files: readonly string[]): string[] {
  return files.filter(isAnimaticFileName).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** 镜头选用的版本：作者选过且仍存在的版本，否则最新版本 */
export function chosenVersionFor(
  state: SceneVideoState,
  shot: Shot,
  files: readonly string[]
): string | null {
  const number = shotNumber(shot);
  if (number === null) return null;
  const versions = shotVersionsFromFiles(files, number);
  const chosen = state.chosenVersions[shot.id];
  if (chosen && versions.some((item) => item.fileName === chosen)) return chosen;
  return versions[0]?.fileName ?? null;
}

// ─── 任务 ───────────────────────────────────────────────────────────────

export interface SceneTaskRef {
  workPath: string;
  chapter: string;
  scene: string;
}

export function isSceneTask(task: VideoTask, ref: SceneTaskRef): boolean {
  return task.workPath === ref.workPath && task.chapter === ref.chapter && task.scene === ref.scene;
}

/** 某镜头最近一次任务（按创建时间） */
export function latestTaskForShot(tasks: readonly VideoTask[], number: number): VideoTask | null {
  let latest: VideoTask | null = null;
  for (const task of tasks) {
    if (task.shotIndex !== number) continue;
    if (!latest || task.createdAt > latest.createdAt) latest = task;
  }
  return latest;
}

export const TASK_STATUS_LABELS: Record<VideoTask['status'], string> = {
  queued: '排队中',
  submitted: '已提交',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function describeTaskStatus(task: VideoTask): string {
  if (task.status === 'running' && typeof task.progress === 'number') {
    return `生成中 ${Math.round(task.progress)}%`;
  }
  if (task.status === 'succeeded' && !task.outputPath) return '下载中';
  return TASK_STATUS_LABELS[task.status];
}

// ─── 费用 ───────────────────────────────────────────────────────────────

export interface PricedProvider {
  label?: string;
  pricePerSecond?: number;
  currency?: CostCurrency;
}

export interface SceneCostEstimate {
  shotCount: number;
  durationSec: number;
  /** 未填写单价时为 null */
  amount: number | null;
  text: string;
}

/** 提交前的费用预估文案（只按作者填写的每秒单价估算，不代表实际账单） */
export function estimateSceneCost(
  shots: readonly Shot[],
  provider: PricedProvider | null
): SceneCostEstimate {
  const durationSec = Math.round(
    storyboardDurationSec({ version: 1, aspectRatio: '16:9', shots: [...shots] })
  );
  const shotCount = shots.length;
  const base = `${shotCount} 个镜头 · 共 ${durationSec} 秒`;
  if (shotCount === 0) return { shotCount, durationSec, amount: null, text: '还没有选中镜头' };
  if (!provider || typeof provider.pricePerSecond !== 'number') {
    return {
      shotCount,
      durationSec,
      amount: null,
      text: `${base} · 未填写单价，无法预估费用`,
    };
  }
  const currency = provider.currency ?? 'CNY';
  const estimate = perSecondEstimator(
    provider.pricePerSecond,
    currency
  )({
    providerId: '',
    durationSec,
  });
  if (!estimate) return { shotCount, durationSec, amount: null, text: base };
  return {
    shotCount,
    durationSec,
    amount: estimate.amount,
    text: `预计 ${formatMoney(estimate.amount, currency)} · ${base}`,
  };
}

// ─── 提示词与回链 ───────────────────────────────────────────────────────

const VIDEO_PROMPT_MAX = 1800;

/** 交给视频模型的提示词：风格 + 比例 + 地点 + 景别运镜 + 画面描述 */
export function buildShotVideoPrompt(shot: Shot, state: SceneVideoState): string {
  const parts = [
    state.style ? `${state.style}风格` : '',
    state.location || shot.location ? `地点：${shot.location || state.location}` : '',
    [shot.shotSize, shot.camera].filter(Boolean).join('，'),
    shot.description.trim(),
  ].filter(Boolean);
  const text = parts.join('。').replace(/。。+/g, '。');
  return Array.from(text).slice(0, VIDEO_PROMPT_MAX).join('');
}

/** 章纲回链条目 */
export function outlineLinkEntry(
  state: SceneVideoState,
  files: readonly string[]
): { title: string; content: string } {
  const dir = sceneRelativeDir(state.chapter, state.scene);
  const videos = state.storyboard.shots
    .map((shot, index) => {
      const file = chosenVersionFor(state, shot, files);
      return file ? `镜头 ${index + 1}：${dir}/${file}` : null;
    })
    .filter((line): line is string => Boolean(line));
  const animatic = animaticFiles(files)[0];
  return {
    title: `场景视频 · ${state.scene}`,
    content: [
      `分镜：${dir}/分镜.md`,
      ...(animatic ? [`样片：${dir}/${animatic}`] : []),
      ...videos,
    ].join('\n'),
  };
}
