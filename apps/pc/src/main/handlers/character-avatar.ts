/**
 * 人物头像 IPC：character-avatar-save
 *
 * 头像保存到 <作品>/资料/人物头像/<人物名>-<内容哈希>.<扩展名>，返回相对作品目录的路径
 * （人物卡 attributes.avatar 保存该相对路径，渲染进程经 read-file-binary 读取显示）。
 *
 * 不信任渲染进程：作品目录必须是存在的绝对路径，窗口已上报工作区时还必须位于其中；
 * 只接受按文件头识别出的 PNG / JPEG / GIF / WebP，大小不超过 5MB；文件名由主进程生成。
 */
import { ipcMain } from 'electron';
import { createHash } from 'crypto';
import { mkdir, readdir, realpath, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { isPathInWorkspace } from './database/workspace-path';
import { getWorkspaceRootForSender } from './session';

export const AVATAR_DIR_SEGMENTS = ['资料', '人物头像'] as const;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export type AvatarSaveResult =
  | { ok: true; data: { relativePath: string; absolutePath: string } }
  | { ok: false; error: string };

/** 按文件头识别图片格式；不是支持的图片时返回 null */
export function detectImageExtension(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (bytes.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'jpg';
  if (bytes.length >= 6 && starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (
    bytes.length >= 12 &&
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** 人物名 → 安全的文件名片段（去掉路径分隔符与控制字符，限制长度） */
export function sanitizeAvatarBaseName(name: string): string {
  const cleaned = Array.from(name)
    .filter((char) => (char.codePointAt(0) ?? 0) >= 0x20 && !'\\/:*?"<>|'.includes(char))
    .join('')
    .replace(/^\.+/, '')
    .trim();
  return Array.from(cleaned).slice(0, 40).join('') || '人物';
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

async function assertWorkDir(raw: unknown, workspaceRoot: string | null): Promise<string> {
  if (typeof raw !== 'string' || !raw.trim() || !path.isAbsolute(raw)) {
    throw new Error('无效的作品目录');
  }
  const resolved = path.resolve(raw);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new Error('作品目录不存在');
  if (workspaceRoot) {
    const [realWork, realRoot] = await Promise.all([
      realpath(resolved),
      realpath(workspaceRoot).catch(() => workspaceRoot),
    ]);
    if (!isPathInWorkspace(realWork, realRoot)) throw new Error('作品目录不在当前打开的项目内');
  }
  return resolved;
}

export async function saveCharacterAvatar(
  workPathRaw: unknown,
  nameRaw: unknown,
  data: unknown,
  workspaceRoot: string | null
): Promise<{ relativePath: string; absolutePath: string }> {
  const workPath = await assertWorkDir(workPathRaw, workspaceRoot);
  if (typeof nameRaw !== 'string' || !nameRaw.trim() || nameRaw.length > 100) {
    throw new Error('无效的人物名');
  }
  const bytes = toBytes(data);
  if (!bytes || bytes.length === 0) throw new Error('没有读取到图片内容');
  if (bytes.length > MAX_AVATAR_BYTES) throw new Error('图片不能超过 5MB');
  const ext = detectImageExtension(bytes);
  if (!ext) throw new Error('只支持 PNG / JPEG / GIF / WebP 图片');

  const dir = path.join(workPath, ...AVATAR_DIR_SEGMENTS);
  await mkdir(dir, { recursive: true });
  const base = sanitizeAvatarBaseName(nameRaw);
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 8);
  const fileName = `${base}-${hash}.${ext}`;
  const target = path.join(dir, fileName);
  if (path.dirname(target) !== dir) throw new Error('无效的文件名');
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, bytes);
  await rename(temp, target);

  // 清理同一人物的旧头像（只删本目录下「人物名-8位哈希.图片」格式的文件）
  const pattern = new RegExp(
    `^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9a-f]{8}\\.(png|jpg|gif|webp)$`
  );
  const entries = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => entry !== fileName && pattern.test(entry))
      .map((entry) => unlink(path.join(dir, entry)).catch(() => undefined))
  );

  return {
    relativePath: [...AVATAR_DIR_SEGMENTS, fileName].join('/'),
    absolutePath: target,
  };
}

export function registerCharacterAvatarHandlers(): void {
  ipcMain.handle(
    'character-avatar-save',
    async (event, workPath: unknown, name: unknown, data: unknown): Promise<AvatarSaveResult> => {
      try {
        const root = getWorkspaceRootForSender(event.sender.id);
        return { ok: true, data: await saveCharacterAvatar(workPath, name, data, root) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
