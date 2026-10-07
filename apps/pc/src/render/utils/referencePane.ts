/**
 * 参考窗格：写作时在编辑器旁边看图片 / 视频 / 听音频（资料、图集、场景视频的成片与样片、配乐与音效）。
 *
 * 任何地方都通过 requestOpenReference 派发窗口事件，由 hooks/useReferencePane 统一接收并显示；
 * 路径是绝对路径（资料文件）或「作品目录 + 相对路径」（图集），由窗格按需读取。
 */
import type { FileNode } from '../types';

export const REFERENCE_OPEN_EVENT = 'novel-editor:open-reference';

export type ReferenceMediaKind = 'image' | 'video' | 'audio';

/** 参考的来源：本章正文引用 / 本章场景视频 / 人物图 / 作者自己加入 */
export type ReferenceGroup = 'chapter' | 'scene-video' | 'character' | 'added';

export const REFERENCE_GROUP_LABELS: Record<ReferenceGroup, string> = {
  chapter: '本章',
  'scene-video': '场景视频',
  character: '人物',
  added: '添加的',
};

export interface ReferenceItem {
  /** 绝对路径 */
  path: string;
  title: string;
  kind: ReferenceMediaKind;
  /** 来源分组（省略视为「添加的」） */
  group?: ReferenceGroup;
  /** auto：「参考」按钮按当前文档自动生成，跟随文档更新；user：作者打开 / 拖入的，保留 */
  origin?: 'auto' | 'user';
  /** 本章引用的标识（语法 + 地址），占位与解析后的条目据此对应 */
  refKey?: string;
  /** 占位：本章引用还没解析出路径（path 为 PENDING_REFERENCE_PREFIX + refKey），解析后原位替换 */
  pending?: boolean;
}

/** 占位条目的 path 前缀（不是文件路径，不会被读取） */
export const PENDING_REFERENCE_PREFIX = 'pending-ref:';

export function isPendingReference(item: Pick<ReferenceItem, 'pending'> | null | undefined) {
  return Boolean(item?.pending);
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|weba)$/i;

export function referenceKindOf(filePath: string): ReferenceMediaKind | null {
  if (IMAGE_RE.test(filePath)) return 'image';
  if (VIDEO_RE.test(filePath)) return 'video';
  if (AUDIO_RE.test(filePath)) return 'audio';
  return null;
}

/** 类型的中文名（信息行、aria-label） */
export const REFERENCE_KIND_LABELS: Record<ReferenceMediaKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

export function isReferenceMedia(filePath: string): boolean {
  return referenceKindOf(filePath) !== null;
}

/** 作品目录 + 相对路径（资料/图集/…）→ 绝对路径 */
export function joinWorkPath(workPath: string, relative: string): string {
  const separator = workPath.includes('\\') && !workPath.includes('/') ? '\\' : '/';
  return [workPath.replace(/[\\/]+$/, ''), ...relative.split(/[\\/]+/).filter(Boolean)].join(
    separator
  );
}

export function referenceItemFor(filePath: string, title?: string): ReferenceItem | null {
  const kind = referenceKindOf(filePath);
  if (!kind) return null;
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  return { path: filePath, title: title || name, kind };
}

export interface OpenReferenceDetail {
  items: ReferenceItem[];
  /** 打开后显示第几张（默认第一张） */
  index?: number;
}

export function requestOpenReference(detail: OpenReferenceDetail): void {
  if (detail.items.length === 0) return;
  window.dispatchEvent(new CustomEvent<OpenReferenceDetail>(REFERENCE_OPEN_EVENT, { detail }));
}

export const REFERENCE_TOGGLE_EVENT = 'novel-editor:toggle-reference';
export const REFERENCE_STATE_EVENT = 'novel-editor:reference-state';

/** 「参考」按钮的自动来源：当前文档（正文引用的媒体、本章场景视频）+ 当前作品人物图 */
export interface ReferenceAutoSource {
  /** 当前文档的绝对路径（没有打开文档时为 null） */
  documentPath: string | null;
  /** 当前文档内容 */
  text: string;
  /** 当前作品目录 */
  workPath: string | null;
  /** 资料文件树（用于查找本章场景视频的成片 / 样片，不额外读磁盘） */
  files: readonly FileNode[];
}

export interface ToggleReferenceDetail {
  /** 当前作品的人物三视图 / 形象图（排在本章引用与场景视频之后） */
  fallback: ReferenceItem[];
  source?: ReferenceAutoSource;
}

/** 编辑器文件栏「参考」按钮：打开 / 收起参考窗格（打开时进入自动模式，跟随当前文档） */
export function requestToggleReference(
  fallback: ReferenceItem[],
  source?: ReferenceAutoSource
): void {
  window.dispatchEvent(
    new CustomEvent<ToggleReferenceDetail>(REFERENCE_TOGGLE_EVENT, {
      detail: { fallback, source },
    })
  );
}

/** 自动来源变化（切换文档 / 作品、编辑指令、资料刷新）：窗格处于自动模式时据此更新 */
export const REFERENCE_AUTO_SOURCE_EVENT = 'novel-editor:reference-auto-source';

export function announceReferenceAutoSource(detail: ToggleReferenceDetail): void {
  window.dispatchEvent(
    new CustomEvent<ToggleReferenceDetail>(REFERENCE_AUTO_SOURCE_EVENT, { detail })
  );
}

/** 文件面板（资料树）拖出的文件：dataTransfer 里携带绝对路径 */
export const NOVEL_EDITOR_PATH_MIME = 'application/x-novel-editor-path';
/** 参考网格内部拖动排序 */
export const REFERENCE_TILE_MIME = 'application/x-novel-editor-reference';

/** 窗格开关状态广播（按钮据此显示按下状态） */
export function announceReferenceState(open: boolean): void {
  window.dispatchEvent(
    new CustomEvent<{ open: boolean }>(REFERENCE_STATE_EVENT, { detail: { open } })
  );
}

export interface ReferenceCharacterSource {
  name: string;
  /** 主要形象图（相对作品目录） */
  avatar?: string;
  turnaround?: string;
}

/** 当前作品人物的默认参考：每人先三视图、再主要形象图（只收作品内的图片文件） */
export function characterReferenceItems(
  workPath: string | null,
  characters: readonly ReferenceCharacterSource[]
): ReferenceItem[] {
  if (!workPath) return [];
  const items: ReferenceItem[] = [];
  const add = (relative: string | undefined, title: string) => {
    if (!relative || /^(data:|https?:)/i.test(relative) || referenceKindOf(relative) !== 'image') {
      return;
    }
    const path = joinWorkPath(workPath, relative);
    if (!items.some((item) => item.path === path)) {
      items.push({ path, title, kind: 'image', group: 'character' });
    }
  };
  for (const character of characters) {
    add(character.turnaround, `${character.name} · 三视图`);
    add(character.avatar, `${character.name} · 形象图`);
  }
  return items.slice(0, 30);
}
