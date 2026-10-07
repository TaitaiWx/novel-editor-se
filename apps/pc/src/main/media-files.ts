/**
 * 作品内图片的安全读取（主进程）：图集参考图、视频参考图 / 首帧图共用。
 * 只读、不创建目录；按 realpath 校验，文件或任一级目录经符号链接指向作品目录之外时拒绝。
 */
import { readFile, realpath, stat } from 'fs/promises';
import path from 'path';
import { isSafeMediaPath } from '@novel-editor/core/entity-media';
import { detectImageExtension } from './handlers/character-avatar';

export const MAX_ENTITY_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 4;

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * 读取 / 删除用：作品内已存在的文件（不创建任何目录）。按 realpath 校验，
 * 文件或任一级目录是指向作品目录之外的符号链接时拒绝；文件不存在时返回 null
 */
export async function resolveExistingInsideWork(
  workPath: string,
  relativeFile: string
): Promise<string | null> {
  if (!isSafeMediaPath(relativeFile)) throw new Error('无效的图片路径');
  const root = path.resolve(workPath);
  const target = path.resolve(root, ...relativeFile.split('/'));
  if (!isInside(root, target)) throw new Error('图片路径不在作品目录内');
  const realTarget = await realpath(target).catch(() => null);
  if (!realTarget) return null;
  const realRoot = await realpath(root);
  if (!isInside(realRoot, realTarget)) throw new Error('图片经符号链接指向了作品目录之外');
  return realTarget;
}

/** 参考图：作品目录内的图片 → data URL（最多 4 张，每张 ≤10MB） */
export async function loadReferenceImages(
  workPath: string,
  references: unknown,
  limit = MAX_REFERENCE_IMAGES
): Promise<string[]> {
  if (!Array.isArray(references)) return [];
  const result: string[] = [];
  // 被跳过的项（不存在 / 不安全 / 不是图片）不占名额；最多检查 limit 的 4 倍项，避免恶意超长列表
  for (const ref of references.slice(0, limit * 4)) {
    if (result.length >= limit) break;
    if (typeof ref !== 'string' || !isSafeMediaPath(ref)) continue;
    const file = await resolveExistingInsideWork(workPath, ref).catch(() => null);
    if (!file) continue;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.size > MAX_ENTITY_IMAGE_BYTES) continue;
    const bytes = new Uint8Array(await readFile(file));
    const ext = detectImageExtension(bytes);
    if (!ext) continue;
    result.push(`data:${MIME_BY_EXT[ext]};base64,${Buffer.from(bytes).toString('base64')}`);
  }
  return result;
}
