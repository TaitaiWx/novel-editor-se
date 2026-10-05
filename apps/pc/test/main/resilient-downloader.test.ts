import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { cleanupStaleDownloads, download } from '../../src/main/resilient-downloader';

type FetchArgs = [string, { headers: Record<string, string>; signal: AbortSignal }];
const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

let dir: string;
let dest: string;
const URL_A = 'https://example.com/app.dmg';

function sha(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function ok(body: string | Uint8Array, status = 200, headers: Record<string, string> = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return new Response(bytes, {
    status,
    headers: { 'content-length': String(bytes.byteLength), ...headers },
  });
}

/** 先吐出一段数据然后网络中断的响应 */
function brokenStream(firstChunk: string): Response {
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(firstChunk));
      } else {
        controller.error(new Error('ECONNRESET'));
      }
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-length': '100' } });
}

function headersOf(callIndex: number): Record<string, string> {
  return fetchMock.mock.calls[callIndex][1].headers;
}

function writeMeta(meta: Record<string, unknown>) {
  writeFileSync(`${dest}.dl-meta`, JSON.stringify(meta));
}

/** 驱动假定时器直到 promise 结束（中间穿插真实 I/O） */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  while (!done) {
    await vi.advanceTimersByTimeAsync(5_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return promise;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ne-dl-'));
  dest = join(dir, 'nested', 'app.dmg');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('download', () => {
  it('完整下载：写入目标文件、校验哈希、清理临时文件', async () => {
    fetchMock.mockResolvedValueOnce(ok('hello world'));
    const onProgress = vi.fn();

    const result = await download({
      url: URL_A,
      destPath: dest,
      expectedHash: sha('hello world'),
      onProgress,
      headers: { Authorization: 'token x' },
    });

    expect(result).toEqual({
      path: dest,
      hash: sha('hello world'),
      size: 11,
      resumed: false,
      attempts: 1,
    });
    expect(readFileSync(dest, 'utf8')).toBe('hello world');
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(`${dest}.dl-meta`)).toBe(false);
    expect(onProgress).toHaveBeenLastCalledWith(11, 11);
    expect(headersOf(0)).toEqual({
      'User-Agent': 'Novel-Editor-Updater',
      Authorization: 'token x',
    });
  });

  it('无 content-length 时用 expectedSize 作为总大小，再兜底为 0', async () => {
    const noLength = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('abc'));
            c.close();
          },
        }),
        { status: 200 }
      );
    fetchMock.mockResolvedValueOnce(noLength());
    const onProgress = vi.fn();
    await download({ url: URL_A, destPath: dest, expectedSize: 42, onProgress });
    expect(onProgress).toHaveBeenLastCalledWith(3, 42);

    fetchMock.mockResolvedValueOnce(noLength());
    const onProgress2 = vi.fn();
    await download({ url: URL_A, destPath: dest, onProgress: onProgress2 });
    expect(onProgress2).toHaveBeenLastCalledWith(3, 0);
  });

  it('大块数据触发背压时正确等待 drain', async () => {
    const big = new Uint8Array(256 * 1024).fill(7);
    fetchMock.mockResolvedValueOnce(ok(big));
    const result = await download({ url: URL_A, destPath: dest });
    expect(result.size).toBe(big.byteLength);
    expect(result.hash).toBe(sha(Buffer.from(big)));
  });

  it('哈希不匹配：删除 .part 和 meta 并抛错', async () => {
    fetchMock.mockResolvedValueOnce(ok('tampered'));
    await expect(
      download({ url: URL_A, destPath: dest, expectedHash: 'a'.repeat(64), maxRetries: 0 })
    ).rejects.toThrow('SHA-256 完整性校验失败 (expected=aaaaaaaaaaaa…)');
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(`${dest}.dl-meta`)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it('已有匹配的 .part + meta 时发送 Range 并在 206 时续传', async () => {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, 'hello ');
    writeMeta({ url: URL_A, downloadedBytes: 6, startedAt: '2020-01-01T00:00:00.000Z' });
    fetchMock.mockResolvedValueOnce(ok('world', 206));
    const onProgress = vi.fn();

    const result = await download({ url: URL_A, destPath: dest, onProgress });

    expect(headersOf(0).Range).toBe('bytes=6-');
    expect(result.resumed).toBe(true);
    expect(result.size).toBe(11);
    expect(readFileSync(dest, 'utf8')).toBe('hello world');
    expect(onProgress).toHaveBeenLastCalledWith(11, 11);
  });

  it('服务器不支持 Range（返回 200）时丢弃已有部分从头写', async () => {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, 'stale-');
    writeMeta({ url: URL_A, downloadedBytes: 6 });
    fetchMock.mockResolvedValueOnce(ok('full content'));

    const result = await download({ url: URL_A, destPath: dest });

    expect(headersOf(0).Range).toBe('bytes=6-');
    expect(result.resumed).toBe(false);
    expect(readFileSync(dest, 'utf8')).toBe('full content');
  });

  it('meta 的 URL 不同或 .part 大小不一致时不续传', async () => {
    mkdirSync(dirname(dest), { recursive: true });

    writeFileSync(`${dest}.part`, 'abc');
    writeMeta({ url: 'https://other/url', downloadedBytes: 3 });
    fetchMock.mockResolvedValueOnce(ok('new'));
    await download({ url: URL_A, destPath: dest });
    expect(headersOf(0).Range).toBeUndefined();

    writeFileSync(`${dest}.part`, 'abcdef');
    writeMeta({ url: URL_A, downloadedBytes: 3 });
    fetchMock.mockResolvedValueOnce(ok('new'));
    await download({ url: URL_A, destPath: dest });
    expect(headersOf(1).Range).toBeUndefined();
  });

  it('损坏的 meta 文件被忽略', async () => {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, 'abc');
    writeFileSync(`${dest}.dl-meta`, '{broken');
    fetchMock.mockResolvedValueOnce(ok('data'));
    const result = await download({ url: URL_A, destPath: dest });
    expect(headersOf(0).Range).toBeUndefined();
    expect(result.size).toBe(4);
  });

  it('416 时删除 .part 并立即从头重下', async () => {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, 'abc');
    writeMeta({ url: URL_A, downloadedBytes: 3 });
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 416 }))
      .mockResolvedValueOnce(ok('fresh'));

    const result = await download({ url: URL_A, destPath: dest });

    expect(headersOf(0).Range).toBe('bytes=3-');
    expect(headersOf(1).Range).toBeUndefined();
    expect(result.attempts).toBe(2);
    expect(readFileSync(dest, 'utf8')).toBe('fresh');
  });

  it('HTTP 错误时指数退避后重试', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('err', { status: 503, statusText: 'Unavailable' }))
      .mockRejectedValueOnce(new Error('ENOTFOUND'))
      .mockResolvedValueOnce(ok('done'));
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const result = await settle(download({ url: URL_A, destPath: dest }));

    expect(result.attempts).toBe(3);
    // Math.random=0.5 → 抖动系数 1.0：1000ms, 2000ms
    const delays = timeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toEqual([1000, 2000]);
  });

  it('退避时间截断在 60 秒', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await expect(settle(download({ url: URL_A, destPath: dest, maxRetries: 8 }))).rejects.toThrow(
      'down'
    );
    const delays = timeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('重试耗尽后抛出最后一次错误', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }));
    await expect(settle(download({ url: URL_A, destPath: dest, maxRetries: 2 }))).rejects.toThrow(
      'HTTP 404 Not Found'
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('最终失败时保留 .part 以便下次续传', async () => {
    fetchMock.mockResolvedValueOnce(brokenStream('partial-'));
    await expect(download({ url: URL_A, destPath: dest, maxRetries: 0 })).rejects.toThrow(
      'ECONNRESET'
    );
    expect(readFileSync(`${dest}.part`, 'utf8')).toBe('partial-');
  });

  it('响应体为空时报错', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(download({ url: URL_A, destPath: dest, maxRetries: 0 })).rejects.toThrow(
      'Response body is null'
    );
  });

  it('已取消的信号直接抛出，不发请求', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(download({ url: URL_A, destPath: dest, signal: controller.signal })).rejects.toBe(
      reason
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('请求过程中被取消时不重试', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort(new Error('user cancel'));
      throw new Error('aborted fetch');
    });
    await expect(
      download({ url: URL_A, destPath: dest, signal: controller.signal })
    ).rejects.toThrow('aborted fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('AbortError 不重试', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(download({ url: URL_A, destPath: dest })).rejects.toThrow('aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('退避等待期间取消立即结束', async () => {
    const controller = new AbortController();
    fetchMock.mockRejectedValue(new Error('flaky'));
    const promise = download({ url: URL_A, destPath: dest, signal: controller.signal });
    const assertion = expect(promise).rejects.toThrow('stop');
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    controller.abort(new Error('stop'));
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 回归：流式写入前只保存了 downloadedBytes=startByte，流中断时 meta 未更新，
  // 导致下次尝试时 partSize !== meta.downloadedBytes，断点续传永远不会生效。
  it('网络中断后重试应使用 Range 从已下载处续传', async () => {
    fetchMock
      .mockResolvedValueOnce(brokenStream('first-half-'))
      .mockResolvedValueOnce(ok('second-half', 206));
    const result = await settle(download({ url: URL_A, destPath: dest }));
    expect(headersOf(1).Range).toBe('bytes=11-');
    expect(result.resumed).toBe(true);
    expect(readFileSync(dest, 'utf8')).toBe('first-half-second-half');
  });

  // 回归：最后一次尝试收到 416 时曾走 `continue` 跳出循环，抛出 "[download] Unreachable"。
  // 未带 Range 的 416 现按普通 HTTP 错误处理并经过退避，因此需用 settle 驱动假定时器。
  it('最后一次尝试返回 416 时应抛出有意义的错误', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 416 }));
    await expect(settle(download({ url: URL_A, destPath: dest, maxRetries: 1 }))).rejects.toThrow(
      /416/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('续传请求在最后一次尝试返回 416 时删除 .part 并抛出说明性错误', async () => {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, 'abc');
    writeMeta({ url: URL_A, downloadedBytes: 3 });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 416 }));
    await expect(download({ url: URL_A, destPath: dest, maxRetries: 0 })).rejects.toThrow(
      /HTTP 416 Range Not Satisfiable/
    );
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(`${dest}.dl-meta`)).toBe(false);
  });

  it('416 且 .part 已完整（Content-Range 总大小一致）时直接校验收尾', async () => {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(`${dest}.part`, 'complete');
    writeMeta({ url: URL_A, downloadedBytes: 8 });
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 416, headers: { 'content-range': 'bytes */8' } })
    );
    const result = await download({ url: URL_A, destPath: dest, expectedHash: sha('complete') });
    expect(result).toMatchObject({ size: 8, resumed: true, attempts: 1 });
    expect(readFileSync(dest, 'utf8')).toBe('complete');
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(`${dest}.dl-meta`)).toBe(false);
  });
});

describe('cleanupStaleDownloads', () => {
  it('目录不存在时返回 0', async () => {
    expect(await cleanupStaleDownloads(join(dir, 'missing'))).toBe(0);
  });

  it('只清理过期的 .part / .dl-meta / .download 文件', async () => {
    const old = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
    const files = ['a.part', 'b.dl-meta', 'c.download', 'd.dmg', 'fresh.part'];
    for (const name of files) writeFileSync(join(dir, name), 'x');
    for (const name of ['a.part', 'b.dl-meta', 'c.download', 'd.dmg']) {
      utimesSync(join(dir, name), old, old);
    }

    const cleaned = await cleanupStaleDownloads(dir);

    expect(cleaned).toBe(3);
    expect(existsSync(join(dir, 'a.part'))).toBe(false);
    expect(existsSync(join(dir, 'b.dl-meta'))).toBe(false);
    expect(existsSync(join(dir, 'c.download'))).toBe(false);
    expect(existsSync(join(dir, 'd.dmg'))).toBe(true);
    expect(existsSync(join(dir, 'fresh.part'))).toBe(true);
  });

  it('支持自定义过期阈值', async () => {
    writeFileSync(join(dir, 'x.part'), 'x');
    const past = (Date.now() - 10_000) / 1000;
    utimesSync(join(dir, 'x.part'), past, past);
    expect(await cleanupStaleDownloads(dir, 60_000)).toBe(0);
    expect(await cleanupStaleDownloads(dir, 1_000)).toBe(1);
  });
});
