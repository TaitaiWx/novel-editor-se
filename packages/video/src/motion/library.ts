/**
 * 作品动作库：`<作品>/资料/动作库/*.bvh`（作者导入的动捕 / AI 生成的动作），与内置动作一起组成预演可用的动作片段。
 *
 * - 片段 id：内置为 `builtin:<名字>`，动作库文件为 `lib:<文件名去掉 .bvh>`（AI 在预演脚本里按 id 引用）
 * - 文件名只校验扩展名与路径分隔符（ASCII 判断），不按文件名里的文字做任何推断
 */
import { parseBvh } from './bvh';
import { builtinMotionClips } from './builtin';
import { retargetBvh, type MotionClip, type RetargetMap } from './retarget';

/** 动作库目录（相对作品目录） */
export const MOTION_LIBRARY_DIR = '资料/动作库';
/** 单个 BVH 文件上限 */
export const MOTION_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const LIBRARY_CLIP_PREFIX = 'lib:';
export const BUILTIN_CLIP_PREFIX = 'builtin:';

/** 合法的动作库文件名：单个路径段、.bvh 结尾、不以点开头 */
export function isMotionFileName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length < 5 || name.length > 120) return false;
  if (/[/\\]/.test(name) || name.startsWith('.')) return false;
  // 控制字符（含 \0）
  for (let i = 0; i < name.length; i += 1) if (name.charCodeAt(i) < 32) return false;
  return /\.bvh$/i.test(name);
}

/** 文件名 → 片段 id（lib:<去掉扩展名>） */
export function libraryClipId(fileName: string): string {
  return `${LIBRARY_CLIP_PREFIX}${fileName.replace(/\.bvh$/i, '')}`;
}

/** 片段 id → 动作库文件名（不是 lib: 开头时为 null） */
export function libraryFileOfClip(clipId: string): string | null {
  if (!clipId.startsWith(LIBRARY_CLIP_PREFIX)) return null;
  const name = `${clipId.slice(LIBRARY_CLIP_PREFIX.length)}.bvh`;
  return isMotionFileName(name) ? name : null;
}

/** 解析 + 重定向一个动作库文件；格式错误时抛出可展示的错误 */
export function motionClipFromBvh(
  fileName: string,
  text: string,
  options: { source?: MotionClip['source']; map?: RetargetMap } = {}
): MotionClip {
  return retargetBvh(parseBvh(text), {
    id: libraryClipId(fileName),
    name: fileName.replace(/\.bvh$/i, ''),
    source: options.source ?? 'library',
    map: options.map,
  });
}

/** 内置动作 + 动作库片段（同 id 时动作库优先） */
export function createMotionLibrary(clips: Iterable<MotionClip> = []): Map<string, MotionClip> {
  const library = new Map<string, MotionClip>(builtinMotionClips());
  for (const clip of clips) library.set(clip.id, clip);
  return library;
}
