/**
 * ResilientDownloader — 断点续传 HTTP 下载器
 *
 * 核心能力:
 *   1. HTTP Range 断点续传 — 网络中断后从已下载处继续
 *   2. 截断指数退避 + 抖动重试 (AWS/GCloud 业界标准算法)
 *   3. .dl-meta sidecar 持久化下载状态 — 进程重启后仍可续传
 *   4. SHA-256 完整性校验
 *   5. 原子写入 (.part → rename) — 不会留下半截文件
 *   6. 过期临时文件自动清理
 *   7. 正确处理 stream 背压 (backpressure)
 *
 * 设计原则:
 *   - 零外部依赖，仅用 Node.js 内置模块
 *   - 与 auto-updater 解耦，可独立复用于任何 HTTP 下载场景
 *   - 所有 I/O 均为流式，内存占用恒定 O(1)
 */
import { createHash } from 'crypto';
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { dirname, join } from 'path';
import log from 'electron-log/main';

// ─── Public Types ─────────────────────────────────────────────────────────

export interface DownloadOptions {
  /** 下载 URL */
  url: string;
  /** 最终目标路径 (下载期间写入 `${destPath}.part`) */
  destPath: string;
  /** 预期 SHA-256 (hex)，下载完成后校验；不符则删除并抛错 */
  expectedHash?: string;
  /** 预期文件大小 (bytes)，用于进度上报兜底 */
  expectedSize?: number;
  /** 单次 HTTP 请求超时 (ms)，默认 5 分钟 */
  timeoutMs?: number;
  /** 最大重试次数，默认 5 */
  maxRetries?: number;
  /** 进度回调: (已下载字节, 总字节) */
  onProgress?: (downloaded: number, total: number) => void;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 附加 HTTP 请求头 */
  headers?: Record<string, string>;
}

export interface DownloadResult {
  /** 最终文件路径 */
  path: string;
  /** SHA-256 hex 摘要 */
  hash: string;
  /** 文件大小 (bytes) */
  size: number;
  /** 是否经历了断点续传 */
  resumed: boolean;
  /** 总尝试次数 */
  attempts: number;
}

// ─── Internal Types ───────────────────────────────────────────────────────

interface DownloadMeta {
  url: string;
  destPath: string;
  expectedHash: string | null;
  expectedSize: number | null;
  downloadedBytes: number;
  startedAt: string;
  lastResumedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const PART_EXT = '.part';
const META_EXT = '.dl-meta';
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ─── Backoff (Truncated Exponential + Jitter) ─────────────────────────────

function backoffDelay(attempt: number): number {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
  // ±25% 均匀抖动 — 防止惊群效应
  return Math.floor(exponential * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

// ─── Path Helpers ─────────────────────────────────────────────────────────

function toPartPath(dest: string) {
  return `${dest}${PART_EXT}`;
}
function toMetaPath(dest: string) {
  return `${dest}${META_EXT}`;
}

// ─── Meta Persistence (原子写入) ──────────────────────────────────────────

async function loadMeta(dest: string): Promise<DownloadMeta | null> {
  try {
    const raw = await readFile(toMetaPath(dest), 'utf8');
    return JSON.parse(raw) as DownloadMeta;
  } catch {
    return null;
  }
}

async function saveMeta(dest: string, meta: DownloadMeta): Promise<void> {
  const mp = toMetaPath(dest);
  const tmp = `${mp}.tmp`;
  await writeFile(tmp, JSON.stringify(meta), 'utf8');
  await rename(tmp, mp);
}

async function removeMeta(dest: string): Promise<void> {
  try {
    await unlink(toMetaPath(dest));
  } catch {
    /* already gone */
  }
}

// ─── File Helpers ─────────────────────────────────────────────────────────

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    /* already gone */
  }
}

/** SHA-256 流式计算 — O(1) 内存 */
async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// ─── Core Download ────────────────────────────────────────────────────────

/**
 * 下载文件，支持断点续传、自动重试、完整性校验。
 *
 * 流程:
 *   1. 检查 `.part` + `.dl-meta` → 决定是否续传
 *   2. 发起 HTTP 请求 (带 Range header 如果续传)
 *   3. 流式写入 `.part`，正确处理背压
 *   4. 完成后 SHA-256 校验 → 原子 rename 到目标路径
 *   5. 失败则截断指数退避后重试，`.part` 保留供下次续传
 */
export async function download(options: DownloadOptions): Promise<DownloadResult> {
  const {
    url,
    destPath,
    expectedHash,
    expectedSize,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    onProgress,
    signal,
    headers: extraHeaders,
  } = options;

  await mkdir(dirname(destPath), { recursive: true });

  let attempts = 0;
  let resumed = false;

  for (let retry = 0; retry <= maxRetries; retry++) {
    if (signal?.aborted) throw signal.reason;
    attempts++;

    try {
      // ── 1. 判断续传条件 ──────────────────────────────────────────
      const meta = await loadMeta(destPath);
      let startByte = 0;

      if (meta && meta.url === url) {
        const partSize = await fileSize(toPartPath(destPath));
        if (partSize > 0 && partSize === meta.downloadedBytes) {
          startByte = partSize;
          log.info(`[download] 断点续传: 已有 ${startByte} bytes`);
        }
      }

      // ── 2. 发起 HTTP 请求 ────────────────────────────────────────
      const reqHeaders: Record<string, string> = {
        'User-Agent': 'Novel-Editor-Updater',
        ...extraHeaders,
      };
      if (startByte > 0) {
        reqHeaders['Range'] = `bytes=${startByte}-`;
      }

      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);

      const response = await fetch(url, {
        headers: reqHeaders,
        signal: fetchSignal,
      });

      // 416 = Range Not Satisfiable → 服务端文件已变更，从头重下
      if (response.status === 416) {
        log.warn('[download] 416 Range Not Satisfiable, 从头下载');
        await safeUnlink(toPartPath(destPath));
        startByte = 0;
        continue;
      }

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const isPartial = response.status === 206;
      if (isPartial && startByte > 0) {
        resumed = true;
        log.info(`[download] 服务器返回 206, 从 byte ${startByte} 续传`);
      } else if (startByte > 0) {
        // 服务器不支持 Range，返回 200 → 丢弃已有部分，从头写
        log.warn('[download] 服务器不支持 Range, 从头下载');
        await safeUnlink(toPartPath(destPath));
        startByte = 0;
      }

      // ── 3. 解析总大小 ───────────────────────────────────────────
      const contentLength = response.headers.get('content-length');
      const totalSize = contentLength
        ? isPartial
          ? startByte + parseInt(contentLength, 10)
          : parseInt(contentLength, 10)
        : (expectedSize ?? 0);

      // ── 4. 保存下载元信息 ───────────────────────────────────────
      const nowIso = new Date().toISOString();
      const newMeta: DownloadMeta = {
        url,
        destPath,
        expectedHash: expectedHash ?? null,
        expectedSize: totalSize || null,
        downloadedBytes: startByte,
        startedAt: meta?.startedAt ?? nowIso,
        lastResumedAt: nowIso,
      };
      await saveMeta(destPath, newMeta);

      // ── 5. 流式写入 .part (正确处理背压) ────────────────────────
      const pp = toPartPath(destPath);
      const writeFlags = isPartial && startByte > 0 ? 'a' : 'w';
      const ws = createWriteStream(pp, { flags: writeFlags });

      let downloaded = startByte;
      const reader = response.body.getReader();

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          // 背压处理: write() 返回 false 时等待 drain
          if (!ws.write(value)) {
            await new Promise<void>((resolve) => ws.once('drain', resolve));
          }
          downloaded += value.byteLength;
          onProgress?.(downloaded, totalSize);
        }
      } finally {
        // 确保 WriteStream 正确关闭
        await new Promise<void>((resolve, reject) => {
          ws.on('finish', resolve);
          ws.on('error', reject);
          ws.end();
        });
      }

      // ── 6. 更新已下载字节 ───────────────────────────────────────
      newMeta.downloadedBytes = downloaded;
      await saveMeta(destPath, newMeta);

      // ── 7. SHA-256 完整性校验 ───────────────────────────────────
      const actualHash = await sha256(pp);
      if (expectedHash && actualHash !== expectedHash) {
        log.error(`[download] SHA-256 不匹配: expected=${expectedHash}, actual=${actualHash}`);
        await safeUnlink(pp);
        await removeMeta(destPath);
        throw new Error(`SHA-256 完整性校验失败 (expected=${expectedHash.slice(0, 12)}…)`);
      }

      // ── 8. 原子 rename → 最终路径 ──────────────────────────────
      await rename(pp, destPath);
      await removeMeta(destPath);

      log.info(
        `[download] 完成: ${destPath} ` +
          `(${downloaded} bytes, sha256=${actualHash.slice(0, 16)}…, ` +
          `attempts=${attempts}, resumed=${resumed})`
      );

      return { path: destPath, hash: actualHash, size: downloaded, resumed, attempts };
    } catch (error) {
      // 用户主动取消 → 不重试，直接抛出
      if (signal?.aborted) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;

      log.warn(`[download] 第 ${attempts} 次尝试失败: ${error}`);

      if (retry < maxRetries) {
        const delay = backoffDelay(retry);
        log.info(`[download] ${delay}ms 后重试 (${retry + 1}/${maxRetries})`);
        await sleep(delay, signal);
      } else {
        // 最终失败，保留 .part 供下次进程重启后续传
        const partSize = await fileSize(toPartPath(destPath));
        if (partSize > 0) {
          log.info(`[download] 保留 ${partSize} bytes .part 文件用于后续续传`);
        }
        throw error;
      }
    }
  }

  // 逻辑上不可达，for 循环必然 return 或 throw
  throw new Error('[download] Unreachable');
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

/**
 * 清理目录中过期的下载残留文件 (.part / .dl-meta)。
 * 默认清理 24 小时前的文件。返回清理的文件数量。
 *
 * 典型调用时机: 应用启动时对下载缓存目录执行一次。
 */
export async function cleanupStaleDownloads(
  dir: string,
  maxAgeMs = STALE_THRESHOLD_MS
): Promise<number> {
  try {
    await access(dir);
  } catch {
    return 0;
  }

  const entries = await readdir(dir);
  const now = Date.now();
  let cleaned = 0;

  for (const name of entries) {
    if (!name.endsWith(PART_EXT) && !name.endsWith(META_EXT) && !name.endsWith('.download')) {
      continue;
    }
    const fullPath = join(dir, name);
    try {
      const s = await stat(fullPath);
      if (now - s.mtimeMs > maxAgeMs) {
        await unlink(fullPath);
        cleaned++;
        log.info(`[cleanup] 已清理过期下载文件: ${name}`);
      }
    } catch {
      /* already gone */
    }
  }

  return cleaned;
}
