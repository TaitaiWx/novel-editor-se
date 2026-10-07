/**
 * 视频产物落盘布局（纯函数，只产出 POSIX 相对路径；主进程负责拼接作品目录并再次校验）
 *
 *   <作品>/资料/视频/<章>/<场景>/镜头1-v1.mp4
 *   <作品>/资料/视频/<章>/<场景>/镜头1-v1.prompt.json   （提示词与参数，便于复现）
 *
 * 章节 / 场景名来自作者输入或 AI，一律当作不可信输入清洗，杜绝路径穿越。
 */
import type { VideoTask } from './task';

export const VIDEO_MATERIAL_SEGMENTS = ['资料', '视频'] as const;

const MAX_SEGMENT_CODE_POINTS = 60;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const FORBIDDEN_CHARS = /[/\\:*?"<>|]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const TRIM_DOTS_SPACES = /^[.\s]+|[.\s]+$/g;

function cleanSegment(name: string): string {
  let text = name.normalize('NFC').replace(CONTROL_CHARS, '').replace(FORBIDDEN_CHARS, '');
  text = text.replace(/\s+/g, ' ').replace(TRIM_DOTS_SPACES, '');
  if (!text || text === '.' || text === '..') return '';
  // Windows 保留设备名（含带扩展名的形式，如 con.txt）
  const dot = text.indexOf('.');
  const stem = dot === -1 ? text : text.slice(0, dot);
  if (WINDOWS_RESERVED.test(stem)) text = `${stem}_${dot === -1 ? '' : text.slice(dot)}`;
  const codePoints = Array.from(text);
  if (codePoints.length > MAX_SEGMENT_CODE_POINTS) {
    text = codePoints.slice(0, MAX_SEGMENT_CODE_POINTS).join('').replace(TRIM_DOTS_SPACES, '');
  }
  return text;
}

/**
 * 把任意名称清洗成单个安全的路径段：
 * 去掉 / \ : * ? " < > | 与控制字符，合并空白，去掉首尾的点和空格，
 * Windows 保留名加「_」，最长 60 个字符（按码点）。清洗后为空时使用 fallback。
 */
export function sanitizePathSegment(name: string, fallback: string): string {
  const cleaned = cleanSegment(typeof name === 'string' ? name : '');
  if (cleaned) return cleaned;
  return cleanSegment(fallback) || '未命名';
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}必须是正整数: ${value}`);
}

function sanitizeExt(ext: string | undefined): string {
  const cleaned = (ext ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 5);
  return cleaned || 'mp4';
}

/** 镜头文件名：镜头1-v2.mp4 */
export function videoShotFileName(shotIndex: number, version: number, ext?: string): string {
  assertPositiveInt(shotIndex, '镜头序号');
  assertPositiveInt(version, '版本号');
  return `镜头${shotIndex}-v${version}.${sanitizeExt(ext)}`;
}

/** 提示词记录文件名：镜头1-v2.prompt.json */
export function videoPromptFileName(shotIndex: number, version: number): string {
  assertPositiveInt(shotIndex, '镜头序号');
  assertPositiveInt(version, '版本号');
  return `镜头${shotIndex}-v${version}.prompt.json`;
}

export interface VideoOutputLayout {
  /** 目录（相对作品目录）：资料/视频/<章>/<场景> */
  dir: string;
  /** 视频文件（相对作品目录的完整路径）：资料/视频/<章>/<场景>/镜头1-v1.mp4 */
  file: string;
  /** 提示词记录（相对作品目录的完整路径） */
  promptFile: string;
  /** 只有文件名：镜头1-v1.mp4 */
  fileName: string;
  /** 只有文件名：镜头1-v1.prompt.json */
  promptFileName: string;
  /** dir 的各段：['资料', '视频', <章>, <场景>] */
  segments: string[];
}

export function videoOutputLayout(input: {
  chapter: string;
  scene: string;
  shotIndex: number;
  version: number;
  ext?: string;
}): VideoOutputLayout {
  const segments = [
    ...VIDEO_MATERIAL_SEGMENTS,
    sanitizePathSegment(input.chapter, '未命名章节'),
    sanitizePathSegment(input.scene, '未命名场景'),
  ];
  const dir = segments.join('/');
  const fileName = videoShotFileName(input.shotIndex, input.version, input.ext);
  const promptFileName = videoPromptFileName(input.shotIndex, input.version);
  return {
    dir,
    file: `${dir}/${fileName}`,
    promptFile: `${dir}/${promptFileName}`,
    fileName,
    promptFileName,
    segments,
  };
}

const SHOT_FILE_RE = /^\u955c\u5934(\d+)-v(\d+)\.([a-z0-9]{1,5})$/i;
const PROMPT_FILE_RE = /^\u955c\u5934(\d+)-v(\d+)\.prompt\.json$/i;

function toPositiveInt(text: string | undefined): number | null {
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 解析镜头文件名（不含 .prompt.json）；不符合命名规则时返回 null */
export function parseShotFileName(
  name: string
): { shotIndex: number; version: number; ext: string } | null {
  const match = SHOT_FILE_RE.exec(name);
  if (!match) return null;
  const shotIndex = toPositiveInt(match[1]);
  const version = toPositiveInt(match[2]);
  if (shotIndex === null || version === null) return null;
  return { shotIndex, version, ext: (match[3] ?? '').toLowerCase() };
}

/**
 * 某镜头的下一个版本号：目录内该镜头最大版本 + 1（没有则为 1）。
 * 同时识别 .prompt.json，提示词已写入但视频尚未下载的版本也视为已占用。
 */
export function nextShotVersion(existingFileNames: readonly string[], shotIndex: number): number {
  let max = 0;
  for (const name of existingFileNames) {
    const parsed = parseShotFileName(name);
    let index = parsed?.shotIndex ?? null;
    let version = parsed?.version ?? null;
    if (!parsed) {
      const match = PROMPT_FILE_RE.exec(name);
      if (!match) continue;
      index = toPositiveInt(match[1]);
      version = toPositiveInt(match[2]);
    }
    if (index === shotIndex && version !== null && version > max) max = version;
  }
  return max + 1;
}

/** 相对路径是否安全：非空、不是绝对路径、没有盘符、没有反斜杠 / NUL、没有「..」段 */
export function isSafeRelativePath(rel: string): boolean {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.includes('\\') || rel.includes('\0')) return false;
  if (rel.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(rel)) return false;
  return rel.split('/').every((segment) => segment !== '..');
}

/** 生成 prompt.json 的内容（schemaVersion 为记录格式版本，version 为镜头版本） */
export function buildPromptRecord(
  task: VideoTask,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    schemaVersion: 1,
    taskId: task.id,
    providerId: task.providerId,
    model: task.model,
    prompt: task.prompt,
    params: task.params,
    chapter: task.chapter,
    scene: task.scene,
    shotIndex: task.shotIndex,
    version: task.version,
    costEstimate: task.costEstimate,
    remoteTaskId: task.remoteTaskId,
    createdAt: new Date(task.createdAt).toISOString(),
    ...extra,
  };
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return record;
}

/** 场景目录中的分镜文件（工作区状态 JSON + 可读的 Markdown 分镜表） */
export const SCENE_STORYBOARD_JSON = '分镜.json';
export const SCENE_STORYBOARD_MARKDOWN = '分镜.md';

export interface VideoSceneLayout {
  /** 目录（相对作品目录）：资料/视频/<章>/<场景> */
  dir: string;
  /** 资料/视频/<章>/<场景>/分镜.json */
  storyboardJson: string;
  /** 资料/视频/<章>/<场景>/分镜.md */
  storyboardMarkdown: string;
  segments: string[];
}

/** 场景目录布局（与 videoOutputLayout 同一套清洗规则，保证镜头与分镜在同一目录） */
export function videoSceneLayout(input: { chapter: string; scene: string }): VideoSceneLayout {
  const segments = [
    ...VIDEO_MATERIAL_SEGMENTS,
    sanitizePathSegment(input.chapter, '未命名章节'),
    sanitizePathSegment(input.scene, '未命名场景'),
  ];
  const dir = segments.join('/');
  return {
    dir,
    storyboardJson: `${dir}/${SCENE_STORYBOARD_JSON}`,
    storyboardMarkdown: `${dir}/${SCENE_STORYBOARD_MARKDOWN}`,
    segments,
  };
}

const ANIMATIC_FILE_RE = /^\u6837\u7247-(\d{8}-\d{6})\.(mp4|webm)$/i;

/** 拼接样片文件名：样片-20261007-153000.mp4（本地时间） */
export function animaticFileName(date: Date, ext: 'mp4' | 'webm'): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `样片-${stamp}.${ext}`;
}

export function isAnimaticFileName(name: string): boolean {
  return ANIMATIC_FILE_RE.test(name);
}
