/**
 * 参考窗格「自动模式」的内容来源与列表操作（纯函数，便于测试）：
 *
 * 1. 本章：当前文档引用的媒体（`::image` / `::video` / `::audio` 指令与 Markdown 图片），路径解析与编辑器实时渲染一致
 * 2. 场景视频：`<作品>/资料/视频/<章>/…` 下每个镜头的最新成片与最新样片（从已加载的文件树查找，不读磁盘）
 * 3. 人物：当前作品人物的三视图 / 形象图
 *
 * 另有：自动内容变化时与作者的排序 / 添加合并（reconcileAutoItems）、拖动排序（moveReferenceItem）、
 * 把参考插入正文时生成指令（buildMediaDirective）。
 */
import {
  audioDirectiveSource,
  imageDirectiveSource,
  videoDirectiveSource,
} from '@novel-editor/core/novel-format';
import {
  VIDEO_MATERIAL_SEGMENTS,
  isAnimaticFileName,
  parseShotFileName,
  sanitizePathSegment,
} from '@novel-editor/video';
import {
  mediaPathCandidates,
  peekResolvedMedia,
  resolveMediaRefs,
} from '../components/TextEditor/live-preview/media-resolve';
import { resolveImageSource } from '../components/TextEditor/live-preview/image-loader';
import type { FileNode } from '../types';
import {
  PENDING_REFERENCE_PREFIX,
  referenceKindOf,
  type ReferenceGroup,
  type ReferenceItem,
  type ReferenceMediaKind,
} from './referencePane';

/** 自动模式最多放多少个参考 */
export const AUTO_REFERENCE_LIMIT = 30;

export interface DocumentMediaRef {
  src: string;
  caption: string;
  kind: ReferenceMediaKind;
  /** directive：地址相对作品目录（逐级向上查找）；markdown：相对文件所在目录 */
  syntax: 'directive' | 'markdown';
}

const MARKDOWN_IMAGE_RE = /!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/g;
const DIRECT_URL_RE = /^(https?:|data:|blob:)/i;

/** 文档里引用的图片 / 视频 / 音频（按出现顺序，同一地址只取一次） */
export function extractDocumentMediaRefs(text: string): DocumentMediaRef[] {
  const refs: DocumentMediaRef[] = [];
  const seen = new Set<string>();
  const push = (ref: DocumentMediaRef) => {
    const key = `${ref.syntax}\n${ref.src}`;
    if (seen.has(key) || DIRECT_URL_RE.test(ref.src)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('::')) {
      const image = imageDirectiveSource(line);
      if (image) {
        push({ src: image.src, caption: image.caption, kind: 'image', syntax: 'directive' });
        continue;
      }
      const video = videoDirectiveSource(line);
      if (video) {
        push({ src: video.src, caption: video.caption, kind: 'video', syntax: 'directive' });
        continue;
      }
      const audio = audioDirectiveSource(line);
      if (audio) {
        push({ src: audio.src, caption: audio.caption, kind: 'audio', syntax: 'directive' });
        continue;
      }
    }
    if (!line.includes('![')) continue;
    MARKDOWN_IMAGE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_IMAGE_RE.exec(line))) {
      const src = match[2];
      const kind = referenceKindOf(src.split(/[?#]/)[0]);
      if (kind) push({ src, caption: match[1], kind, syntax: 'markdown' });
    }
  }
  return refs;
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** 本章引用的标识：语法 + 地址（同一文档内唯一） */
export function documentMediaRefKey(ref: Pick<DocumentMediaRef, 'syntax' | 'src'>): string {
  return `${ref.syntax}\n${ref.src}`;
}

function chapterItem(ref: DocumentMediaRef, path: string): ReferenceItem {
  return {
    path,
    title: ref.caption.trim() || baseName(path),
    kind: ref.kind,
    group: 'chapter',
    origin: 'auto',
    refKey: documentMediaRefKey(ref),
  };
}

/** 还没解析出路径的引用：占位（标题取说明文字，类型按扩展名），解析后原位替换 */
export function pendingChapterItem(ref: DocumentMediaRef): ReferenceItem {
  const refKey = documentMediaRefKey(ref);
  const name = baseName(ref.src.split(/[?#]/)[0]);
  return {
    path: `${PENDING_REFERENCE_PREFIX}${refKey}`,
    title: ref.caption.trim() || name,
    kind: referenceKindOf(name) ?? ref.kind,
    group: 'chapter',
    origin: 'auto',
    refKey,
    pending: true,
  };
}

/** 按解析结果（与 refs 一一对应，null = 找不到）生成本章条目，同一路径只取一次 */
function itemsFromResolved(
  refs: readonly DocumentMediaRef[],
  resolved: ReadonlyArray<string | null | undefined>
): ReferenceItem[] {
  const items: ReferenceItem[] = [];
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    const found = resolved[index];
    if (found === null) return;
    const item = found === undefined ? pendingChapterItem(ref) : chapterItem(ref, found);
    if (seen.has(item.path)) return;
    seen.add(item.path);
    items.push(item);
  });
  return items;
}

/** 解析文档引用为本地文件（exists 判断候选路径是否存在；找不到的引用跳过） */
export async function resolveDocumentMedia(
  refs: readonly DocumentMediaRef[],
  documentPath: string | null,
  exists: (path: string) => Promise<boolean>
): Promise<ReferenceItem[]> {
  const resolved: Array<string | null> = [];
  for (const ref of refs) {
    const candidates =
      ref.syntax === 'directive'
        ? mediaPathCandidates(documentPath, ref.src)
        : [resolveImageSource(ref.src, documentPath)];
    let found: string | null = null;
    for (const candidate of candidates) {
      if (!candidate || DIRECT_URL_RE.test(candidate)) continue;
      if (await exists(candidate)) {
        found = candidate;
        break;
      }
    }
    resolved.push(found);
  }
  return itemsFromResolved(refs, resolved);
}

/** 经共享解析缓存（media-resolve）解析：已缓存的直接用，其余一次批量探测 */
export async function resolveDocumentMediaCached(
  refs: readonly DocumentMediaRef[],
  documentPath: string | null
): Promise<ReferenceItem[]> {
  return itemsFromResolved(refs, await resolveMediaRefs(documentPath, refs));
}

/**
 * 同步生成本章条目：缓存里有的直接用，没解析过的放占位（保持文档顺序），确认找不到的跳过。
 * peek 默认读共享解析缓存。
 */
export function peekDocumentMedia(
  refs: readonly DocumentMediaRef[],
  documentPath: string | null,
  peek: (ref: DocumentMediaRef) => string | null | undefined = (ref) =>
    peekResolvedMedia(documentPath, ref)
): ReferenceItem[] {
  return itemsFromResolved(
    refs,
    refs.map((ref) => peek(ref))
  );
}

/** 占位条目的选中路径换成解析后的路径（还没解析或找不到时原样返回） */
export function remapPendingSelection(
  selected: string | null,
  resolved: readonly ReferenceItem[]
): string | null {
  if (!selected || !selected.startsWith(PENDING_REFERENCE_PREFIX)) return selected;
  const refKey = selected.slice(PENDING_REFERENCE_PREFIX.length);
  return resolved.find((item) => !item.pending && item.refKey === refKey)?.path ?? selected;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function findNode(nodes: readonly FileNode[], target: string): FileNode | null {
  const wanted = normalize(target);
  for (const node of nodes) {
    const current = normalize(node.path);
    if (current === wanted) return node;
    if (node.type === 'directory' && node.children && wanted.startsWith(`${current}/`)) {
      const found = findNode(node.children, target);
      if (found) return found;
    }
  }
  return null;
}

function joinPath(base: string, ...segments: string[]): string {
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...segments].join(separator);
}

/** 章节名：文件名去掉扩展名（与场景视频落盘一致） */
function chapterNameOf(documentPath: string): string {
  const base = baseName(documentPath);
  return base.replace(/\.[^.]+$/, '') || base;
}

/**
 * 本章场景视频：每个场景目录里每个镜头的最新版本成片 + 最新一条样片。
 * 从文件树查找，目录不存在时为空。
 */
export function sceneVideoReferenceItems(
  files: readonly FileNode[],
  workPath: string | null,
  documentPath: string | null
): ReferenceItem[] {
  if (!workPath || !documentPath) return [];
  const chapterDir = joinPath(
    workPath,
    ...VIDEO_MATERIAL_SEGMENTS,
    sanitizePathSegment(chapterNameOf(documentPath), '')
  );
  const chapter = findNode(files, chapterDir);
  if (!chapter || chapter.type !== 'directory') return [];
  const items: ReferenceItem[] = [];
  for (const scene of chapter.children ?? []) {
    if (scene.type !== 'directory') continue;
    const latest = new Map<number, { version: number; node: FileNode }>();
    let animatic: FileNode | null = null;
    for (const file of scene.children ?? []) {
      if (file.type !== 'file' || referenceKindOf(file.name) !== 'video') continue;
      if (isAnimaticFileName(file.name)) {
        if (!animatic || file.name > animatic.name) animatic = file;
        continue;
      }
      const parsed = parseShotFileName(file.name);
      if (!parsed) continue;
      const previous = latest.get(parsed.shotIndex);
      if (!previous || parsed.version > previous.version) {
        latest.set(parsed.shotIndex, { version: parsed.version, node: file });
      }
    }
    const shots = [...latest.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, { node }] of shots) {
      items.push({
        path: node.path,
        title: `${scene.name} · ${node.name.replace(/\.[^.]+$/, '')}`,
        kind: 'video',
        group: 'scene-video',
        origin: 'auto',
      });
    }
    if (animatic) {
      items.push({
        path: animatic.path,
        title: `${scene.name} · ${animatic.name.replace(/\.[^.]+$/, '')}`,
        kind: 'video',
        group: 'scene-video',
        origin: 'auto',
      });
    }
  }
  return items;
}

/** 自动内容：本章 → 场景视频 → 人物，同一路径只保留第一次出现，最多 AUTO_REFERENCE_LIMIT 个 */
export function combineAutoItems(...groups: ReadonlyArray<readonly ReferenceItem[]>) {
  const seen = new Set<string>();
  const items: ReferenceItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      items.push({ ...item, origin: 'auto' });
    }
  }
  return items.slice(0, AUTO_REFERENCE_LIMIT);
}

const GROUP_RANK: Record<ReferenceGroup, number> = {
  chapter: 0,
  'scene-video': 1,
  character: 2,
  added: 3,
};

export function groupOf(item: ReferenceItem): ReferenceGroup {
  return item.group ?? 'added';
}

/**
 * 自动内容变化后的新列表：
 * - 作者打开 / 拖入的（origin 不是 auto）原位保留
 * - 仍然存在的自动项保留作者排好的位置（标题 / 分组更新）
 * - 不再存在的自动项移除；作者移除过的（dismissed）不再出现
 * - 占位（pending）被同一引用解析出的条目原位替换
 * - 新增的自动项插到同组最后一项之后；同组没有时插到后面分组之前
 */
export function reconcileAutoItems(
  current: readonly ReferenceItem[],
  nextAuto: readonly ReferenceItem[],
  dismissed: ReadonlySet<string> = new Set()
): ReferenceItem[] {
  const isDismissed = (item: ReferenceItem) =>
    dismissed.has(item.path) ||
    (item.refKey !== undefined && dismissed.has(`${PENDING_REFERENCE_PREFIX}${item.refKey}`));
  const nextByPath = new Map(
    nextAuto.filter((item) => !isDismissed(item)).map((item) => [item.path, item])
  );
  const result: ReferenceItem[] = [];
  for (const item of current) {
    if (item.origin !== 'auto') {
      result.push(item);
      // 作者手动加入的与自动内容重复时，以作者的为准
      nextByPath.delete(item.path);
      continue;
    }
    // 占位：解析出的条目（同一 refKey）原位替换，不改变其他条目的顺序
    let updated = nextByPath.get(item.path);
    if (!updated && item.pending && item.refKey !== undefined) {
      updated = [...nextByPath.values()].find((entry) => entry.refKey === item.refKey);
    }
    if (!updated) continue;
    result.push(updated);
    nextByPath.delete(updated.path);
  }
  for (const item of nextByPath.values()) {
    const group = groupOf(item);
    let insertAt = -1;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (result[index].origin === 'auto' && groupOf(result[index]) === group) {
        insertAt = index + 1;
        break;
      }
    }
    if (insertAt < 0) {
      const later = result.findIndex(
        (entry) => entry.origin === 'auto' && GROUP_RANK[groupOf(entry)] > GROUP_RANK[group]
      );
      insertAt = later < 0 ? result.length : later;
    }
    result.splice(insertAt, 0, item);
  }
  // 占位解析出的路径可能与已有条目重复：保留先出现的
  const seen = new Set<string>();
  return result.filter((item) => !seen.has(item.path) && Boolean(seen.add(item.path)));
}

/** 把 from 位置的参考移到 to 位置（越界时夹到两端；位置不变时返回原数组） */
export function moveReferenceItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (target === from) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** 在 index 位置插入新参考（已存在的同一路径先移除），最多 AUTO_REFERENCE_LIMIT 个 */
export function insertReferenceItems(
  current: readonly ReferenceItem[],
  added: readonly ReferenceItem[],
  index: number
): ReferenceItem[] {
  const paths = new Set(added.map((item) => item.path));
  const before = current.slice(0, Math.max(0, index)).filter((item) => !paths.has(item.path));
  const after = current.slice(Math.max(0, index)).filter((item) => !paths.has(item.path));
  return [...before, ...added, ...after].slice(0, AUTO_REFERENCE_LIMIT);
}

/** 拖动排序的落点：指针在目标前半部分时插到它前面，否则插到后面（已扣除移走的那一项） */
export function dropTargetIndex(from: number, over: number, after: boolean): number {
  const raw = after ? over + 1 : over;
  return from < raw ? raw - 1 : raw;
}

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes('\\');
}

/** absolute 相对 baseDir 的路径（统一用 /）；不在 baseDir 内时返回 null */
export function relativeToDir(absolute: string, baseDir: string): string | null {
  const caseInsensitive = isWindowsPath(absolute) || isWindowsPath(baseDir);
  const fix = (value: string) => {
    const slashed = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return caseInsensitive ? slashed.toLowerCase() : slashed;
  };
  const target = fix(absolute);
  const base = fix(baseDir);
  if (!base || !target.startsWith(`${base}/`)) return null;
  return absolute.replace(/\\/g, '/').slice(base.length + 1);
}

/**
 * 插入正文的指令：`::image[标题]{src="相对路径"}` / `::video[…]{…}` / `::audio[…]{…}`。
 * 路径优先相对作品目录（文档在作品内时），否则相对文档所在目录，都不行时用绝对路径。
 */
export function buildMediaDirective(
  item: Pick<ReferenceItem, 'path' | 'title' | 'kind'>,
  documentPath: string | null,
  workPath: string | null
): string {
  const documentDir = documentPath ? documentPath.replace(/[\\/][^\\/]*$/, '') : null;
  const insideWork =
    documentPath && workPath ? relativeToDir(documentPath, workPath) !== null : false;
  const src =
    (insideWork && workPath ? relativeToDir(item.path, workPath) : null) ??
    (documentDir ? relativeToDir(item.path, documentDir) : null) ??
    item.path.replace(/\\/g, '/');
  const caption = item.title.replace(/[[\]\n]/g, ' ').trim();
  return `::${item.kind}[${caption}]{src="${src.replace(/"/g, '%22')}"}`;
}
