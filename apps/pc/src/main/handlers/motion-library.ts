/**
 * 作品动作库 IPC：motion-library-list / read / import
 *
 * 动作库在 <作品>/资料/动作库/*.bvh（3D 预演的动作片段，来自动作捕捉或「文字 → 动作」AI 模型），渲染进程只传
 * 作品目录 + 文件名，主进程负责：
 * - 作品目录必须是存在的绝对路径，且位于该窗口打开的项目内（与场景视频同一个 assertWorkPath）
 * - 文件名只能是单个路径段、.bvh 结尾（@novel-editor/video isMotionFileName），单个文件 ≤ 5MB
 * - 读取前用 realpath 确认（含符号链接）仍在作品目录内；导入时内容必须能解析为 BVH，同名时自动加序号，独占创建不覆盖
 */
import { ipcMain } from 'electron';
import { readdir, readFile, realpath, stat, writeFile } from 'fs/promises';
import path from 'path';
import { AIError, toAIError } from '@novel-editor/ai';
import {
  MOTION_FILE_MAX_BYTES,
  MOTION_LIBRARY_DIR,
  isMotionFileName,
  libraryClipId,
  parseBvh,
} from '@novel-editor/video';
import type {
  AIIpcResult,
  MotionLibraryEntry,
  MotionLibraryImportResult,
  MotionLibraryListResult,
} from '../../shared/ai';
import { resolveInsideWork } from '../video/download';

export interface MotionLibraryHandlerDeps {
  assertWorkPath(raw: unknown, workspaceRoot: string | null): Promise<string>;
  workspaceRootFor(senderId: number | undefined): string | null;
}

async function guard<T>(task: () => Promise<T> | T): Promise<AIIpcResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: toAIError(error).toJSON() };
  }
}

function badRequest(message: string): AIError {
  return new AIError({ kind: 'bad-request', message });
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const dirSegments = () => MOTION_LIBRARY_DIR.split('/');

async function workPathOf(
  raw: unknown,
  deps: MotionLibraryHandlerDeps,
  senderId: number | undefined
): Promise<string> {
  if (typeof raw !== 'object' || raw === null) throw badRequest('无效的请求');
  return deps.assertWorkPath(
    (raw as { workPath?: unknown }).workPath,
    deps.workspaceRootFor(senderId)
  );
}

/** 动作库目录的真实路径（经符号链接也必须在作品目录内）；不存在时为 null */
async function libraryDir(workPath: string): Promise<string | null> {
  const dir = path.join(workPath, ...dirSegments());
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) return null;
  const [realRoot, realDir] = await Promise.all([realpath(workPath), realpath(dir)]);
  if (!isInside(realRoot, realDir)) throw badRequest('动作库目录经符号链接指向了作品目录之外');
  return realDir;
}

export async function listMotionLibrary(workPath: string): Promise<MotionLibraryListResult> {
  const dir = await libraryDir(workPath);
  if (!dir) return { files: [] };
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: MotionLibraryEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isMotionFileName(entry.name)) continue;
    const info = await stat(path.join(dir, entry.name)).catch(() => null);
    if (!info || info.size > MOTION_FILE_MAX_BYTES) continue;
    files.push({
      fileName: entry.name,
      clipId: libraryClipId(entry.name),
      size: info.size,
      mtimeMs: Math.round(info.mtimeMs),
    });
  }
  files.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { files };
}

export async function readMotionFile(workPath: string, fileName: unknown): Promise<string> {
  if (!isMotionFileName(fileName)) throw badRequest('只能读取动作库里的 .bvh 文件');
  const dir = await libraryDir(workPath);
  if (!dir) throw badRequest('动作文件不存在');
  const file = path.join(dir, fileName);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw badRequest('动作文件不存在');
  const real = await realpath(file);
  if (!isInside(dir, real)) throw badRequest('动作文件经符号链接指向了动作库之外');
  if (info.size > MOTION_FILE_MAX_BYTES) throw badRequest('动作文件超过 5MB');
  return readFile(real, 'utf-8');
}

/** 同名时加序号：wave.bvh → wave-2.bvh */
function numbered(fileName: string, index: number): string {
  if (index <= 1) return fileName;
  const ext = path.extname(fileName);
  return `${fileName.slice(0, -ext.length)}-${index}${ext}`;
}

export async function importMotionFile(
  workPath: string,
  fileName: unknown,
  data: unknown
): Promise<MotionLibraryImportResult> {
  if (!isMotionFileName(fileName)) throw badRequest('只支持导入 .bvh 动作文件');
  if (typeof data !== 'string' || !data.trim()) throw badRequest('动作文件为空');
  if (Buffer.byteLength(data, 'utf-8') > MOTION_FILE_MAX_BYTES) {
    throw badRequest('动作文件超过 5MB');
  }
  try {
    parseBvh(data);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'BVH 格式错误');
  }
  for (let index = 1; index <= 99; index += 1) {
    const name = numbered(fileName, index);
    if (!isMotionFileName(name)) break;
    const target = await resolveInsideWork(workPath, `${MOTION_LIBRARY_DIR}/${name}`);
    try {
      await writeFile(target, data, { encoding: 'utf-8', flag: 'wx' });
      return { fileName: name, clipId: libraryClipId(name) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw badRequest('同名动作文件过多，请先改名');
}

export function registerMotionLibraryHandlers(deps: MotionLibraryHandlerDeps): void {
  ipcMain.handle('motion-library-list', (event, raw: unknown) =>
    guard(async () => listMotionLibrary(await workPathOf(raw, deps, event?.sender?.id)))
  );
  ipcMain.handle('motion-library-read', (event, raw: unknown) =>
    guard(async () =>
      readMotionFile(
        await workPathOf(raw, deps, event?.sender?.id),
        (raw as { fileName?: unknown }).fileName
      )
    )
  );
  ipcMain.handle('motion-library-import', (event, raw: unknown) =>
    guard(async () => {
      const workPath = await workPathOf(raw, deps, event?.sender?.id);
      const payload = raw as { fileName?: unknown; data?: unknown };
      return importMotionFile(workPath, payload.fileName, payload.data);
    })
  );
}
