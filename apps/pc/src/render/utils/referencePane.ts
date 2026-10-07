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
