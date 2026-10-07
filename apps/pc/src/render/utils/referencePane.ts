/**
 * 参考窗格：写作时在编辑器旁边看图片 / 视频（资料、图集、场景视频的成片与样片）。
 *
 * 任何地方都通过 requestOpenReference 派发窗口事件，由 hooks/useReferencePane 统一接收并显示；
 * 路径是绝对路径（资料文件）或「作品目录 + 相对路径」（图集），由窗格按需读取。
 */

export const REFERENCE_OPEN_EVENT = 'novel-editor:open-reference';

export type ReferenceMediaKind = 'image' | 'video';

export interface ReferenceItem {
  /** 绝对路径 */
  path: string;
  title: string;
  kind: ReferenceMediaKind;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;

export function referenceKindOf(filePath: string): ReferenceMediaKind | null {
  if (IMAGE_RE.test(filePath)) return 'image';
  if (VIDEO_RE.test(filePath)) return 'video';
  return null;
}

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

export interface ToggleReferenceDetail {
  /** 窗格还没有内容时显示的默认参考（例如当前作品的人物三视图 / 形象图） */
  fallback: ReferenceItem[];
}

/** 编辑器文件栏「参考」按钮：打开 / 收起参考窗格 */
export function requestToggleReference(fallback: ReferenceItem[]): void {
  window.dispatchEvent(
    new CustomEvent<ToggleReferenceDetail>(REFERENCE_TOGGLE_EVENT, { detail: { fallback } })
  );
}

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
    if (!items.some((item) => item.path === path)) items.push({ path, title, kind: 'image' });
  };
  for (const character of characters) {
    add(character.turnaround, `${character.name} · 三视图`);
    add(character.avatar, `${character.name} · 形象图`);
  }
  return items.slice(0, 30);
}
