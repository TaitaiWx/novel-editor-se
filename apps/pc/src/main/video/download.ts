/**
 * 视频成片下载与落盘路径校验
 *
 * - 只允许 http(s) 下载地址；先写到 `<目标>.part`，完成后改名，避免半个文件被当成成片
 * - 输出路径必须位于作品目录内（拒绝 `..`、绝对路径、以及经符号链接逃出作品目录的情况）
 */
import { createWriteStream } from 'fs';
import { mkdir, realpath, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { AIError, errorFromHttpResponse } from '@novel-editor/ai';
import { isSafeRelativePath } from '@novel-editor/video';

export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 把作品内的相对路径（POSIX）解析为绝对路径，并确认不会逃出作品目录。
 * 会创建父目录，并用 realpath 检查父目录（防止 资料/视频 是指向外部的符号链接）。
 */
export async function resolveInsideWork(workPath: string, relativeFile: string): Promise<string> {
  if (!path.isAbsolute(workPath)) throw new Error('作品目录必须是绝对路径');
  if (!isSafeRelativePath(relativeFile)) throw new Error(`不安全的输出路径: ${relativeFile}`);
  const root = path.resolve(workPath);
  const target = path.resolve(root, ...relativeFile.split('/'));
  if (!isInside(root, target) || target === root) {
    throw new Error(`输出路径不在作品目录内: ${relativeFile}`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  const [realRoot, realParent] = await Promise.all([
    realpath(root),
    realpath(path.dirname(target)),
  ]);
  if (!isInside(realRoot, realParent)) {
    throw new Error(`输出目录经符号链接指向了作品目录之外: ${relativeFile}`);
  }
  return path.join(realParent, path.basename(target));
}

export interface DownloadOptions {
  signal?: AbortSignal;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  maxBytes?: number;
  /** 下载需要的请求头（例如 Gemini 文件下载要带 Key）；只在内存中使用，不得写入任务记录或日志 */
  headers?: Record<string, string>;
}

export async function downloadToFile(
  url: string,
  destination: string,
  options: DownloadOptions = {}
): Promise<number> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AIError({ kind: 'invalid-response', message: '下载地址无效', retryable: false });
  }
  // 部分服务（Gemini Omni）把成片直接放在结果里：data:video/...;base64,...
  if (parsed.protocol === 'data:') {
    return writeDataUrlVideo(url, destination, options.maxBytes ?? MAX_VIDEO_BYTES);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AIError({
      kind: 'invalid-response',
      message: '下载地址只支持 http / https',
      retryable: false,
    });
  }
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  let response: Response;
  try {
    response = await doFetch(url, {
      signal: options.signal,
      ...(options.headers ? { headers: options.headers } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw new AIError({ kind: 'aborted', message: '下载已取消' });
    throw new AIError({
      kind: 'network',
      message: `下载视频失败: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (!response.ok) {
    throw errorFromHttpResponse(response.status, await response.text().catch(() => ''), {
      fallbackMessage: `下载视频失败 (HTTP ${response.status})`,
    });
  }
  if (!response.body) throw new AIError({ kind: 'invalid-response', message: '下载内容为空' });
  const maxBytes = options.maxBytes ?? MAX_VIDEO_BYTES;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AIError({ kind: 'invalid-response', message: '视频文件过大', retryable: false });
  }
  const partial = `${destination}.part`;
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(
          new AIError({ kind: 'invalid-response', message: '视频文件过大', retryable: false })
        );
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      limiter,
      createWriteStream(partial),
      { signal: options.signal }
    );
    if (bytes === 0) throw new AIError({ kind: 'invalid-response', message: '下载内容为空' });
    await rename(partial, destination);
    return bytes;
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    if (error instanceof AIError) throw error;
    if (options.signal?.aborted) throw new AIError({ kind: 'aborted', message: '下载已取消' });
    throw new AIError({
      kind: 'network',
      message: `下载视频失败: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** 写入 data: URL 里的视频（只接受 video/* 的 base64），同样先写 .part 再改名 */
async function writeDataUrlVideo(url: string, destination: string, maxBytes: number) {
  const match = /^data:(video\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!match) {
    throw new AIError({ kind: 'invalid-response', message: '内嵌视频格式无效', retryable: false });
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) throw new AIError({ kind: 'invalid-response', message: '下载内容为空' });
  if (bytes.length > maxBytes) {
    throw new AIError({ kind: 'invalid-response', message: '视频文件过大', retryable: false });
  }
  const partial = `${destination}.part`;
  try {
    await writeFile(partial, bytes);
    await rename(partial, destination);
    return bytes.length;
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}
