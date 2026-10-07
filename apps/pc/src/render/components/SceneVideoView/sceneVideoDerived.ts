/**
 * 场景视频的派生计算（从 sceneVideoState.ts 拆出）：成片路径与版本、任务状态、费用预估、
 * 视频提示词与章纲回链、画布自动化（需要生成的镜头、自动合成样片）。
 */
import {
  formatMoney,
  isAnimaticFileName,
  parseShotFileName,
  perSecondEstimator,
  storyboardDurationSec,
  videoSceneLayout,
  type CostCurrency,
  type Shot,
  type VideoTask,
} from '@novel-editor/video';
import { shotNumber, type SceneVideoState } from './sceneVideoState';

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
  const text = parts.join('。').replace(/\u3002\u3002+/g, '。');
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

// ─── 自动化（画布：生成缺少的镜头、自动合成样片） ────────────────────────────

function isActiveTask(task: VideoTask): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'submitted' ||
    task.status === 'running' ||
    (task.status === 'succeeded' && !task.outputPath)
  );
}

export type ShotProgress =
  | { kind: 'empty' }
  | { kind: 'active'; text: string; progress: number | null }
  | { kind: 'failed'; text: string }
  | { kind: 'done'; fileName: string; version: number; versions: number };

/** 镜头在画布上的状态：有进行中的任务 → 生成中；有成片 → 已完成（选用的版本）；最近一次失败 → 失败 */
export function shotProgress(
  state: SceneVideoState,
  shot: Shot,
  files: readonly string[],
  tasks: readonly VideoTask[]
): ShotProgress {
  const number = shotNumber(shot);
  if (number === null) return { kind: 'empty' };
  const latest = latestTaskForShot(tasks, number);
  if (latest && isActiveTask(latest)) {
    return {
      kind: 'active',
      text: describeTaskStatus(latest),
      progress:
        latest.status === 'running' && typeof latest.progress === 'number' ? latest.progress : null,
    };
  }
  const chosen = chosenVersionFor(state, shot, files);
  if (chosen) {
    const versions = shotVersionsFromFiles(files, number);
    const version = versions.find((item) => item.fileName === chosen)?.version ?? 0;
    return { kind: 'done', fileName: chosen, version, versions: versions.length };
  }
  if (latest?.status === 'failed') {
    return { kind: 'failed', text: latest.error?.message || '生成失败' };
  }
  return { kind: 'empty' };
}

/** 「生成视频」要提交的镜头：有画面描述、还没有成片、也没有进行中的任务 */
export function shotsNeedingGeneration(
  state: SceneVideoState,
  files: readonly string[],
  tasks: readonly VideoTask[]
): Shot[] {
  return state.storyboard.shots.filter((shot) => {
    if (!shot.description.trim()) return false;
    const progress = shotProgress(state, shot, files, tasks);
    return progress.kind === 'empty' || progress.kind === 'failed';
  });
}

/** 样片签名：每个镜头选用的版本（顺序敏感）；有镜头还没有成片时为 null（不自动合成） */
export function animaticSignatureFor(
  state: SceneVideoState,
  files: readonly string[]
): string | null {
  const shots = state.storyboard.shots;
  if (shots.length === 0) return null;
  const parts: string[] = [];
  for (const shot of shots) {
    const file = chosenVersionFor(state, shot, files);
    if (!file) return null;
    parts.push(file);
  }
  return parts.join('|');
}

/** 是否自动合成样片：全部镜头都有成片、没有进行中的任务、选用的版本与上次合成时不同 */
export function shouldAutoStitch(
  state: SceneVideoState,
  files: readonly string[],
  tasks: readonly VideoTask[]
): string | null {
  if (tasks.some(isActiveTask)) return null;
  const signature = animaticSignatureFor(state, files);
  if (!signature || signature === state.animaticSignature) return null;
  return signature;
}
