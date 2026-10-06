import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { uploadLogBundle, type FetchLike } from '../../../src/main/log-upload/uploader';
import { getLogUploadEndpoint } from '../../../src/main/log-upload/config';

const zip = Buffer.from('PK-fake-zip');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseOptions(fetchImpl: FetchLike) {
  return {
    endpoint: 'https://logs.example.com/v1/log-bundles',
    zip,
    deviceId: 'dev-1',
    appVersion: '1.2.3',
    reason: 'manual' as const,
    platform: 'darwin-arm64',
    fetchImpl,
    retryDelayMs: 0,
  };
}

describe('getLogUploadEndpoint', () => {
  it('优先读取环境变量；未配置或非法时返回 null', () => {
    expect(getLogUploadEndpoint({})).toBeNull();
    expect(getLogUploadEndpoint({ NOVEL_EDITOR_LOG_UPLOAD_URL: '  ' })).toBeNull();
    expect(getLogUploadEndpoint({ NOVEL_EDITOR_LOG_UPLOAD_URL: 'ftp://x' })).toBeNull();
    expect(getLogUploadEndpoint({ NOVEL_EDITOR_LOG_UPLOAD_URL: 'not a url' })).toBeNull();
    expect(getLogUploadEndpoint({ NOVEL_EDITOR_LOG_UPLOAD_URL: 'https://a.example/up' })).toBe(
      'https://a.example/up'
    );
  });
});

describe('uploadLogBundle', () => {
  it('POST application/zip，带设备 / 版本 / 原因等请求头，返回工单编号', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ ok: true, ticketId: 'T-1' }));
    await expect(uploadLogBundle(baseOptions(fetchImpl))).resolves.toEqual({
      ok: true,
      ticketId: 'T-1',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://logs.example.com/v1/log-bundles');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/zip',
      'X-Device-Id': 'dev-1',
      'X-App-Version': '1.2.3',
      'X-Upload-Reason': 'manual',
      'X-Platform': 'darwin-arm64',
      'X-Bundle-Sha256': createHash('sha256').update(zip).digest('hex'),
    });
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe('PK-fake-zip');
  });

  it('响应没有 ticketId 时返回 null', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ ok: true }));
    await expect(uploadLogBundle(baseOptions(fetchImpl))).resolves.toEqual({
      ok: true,
      ticketId: null,
    });
  });

  it('网络错误与 5xx 重试 1 次', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ ok: true, ticketId: 'T-2' }));
    await expect(uploadLogBundle(baseOptions(fetchImpl))).resolves.toEqual({
      ok: true,
      ticketId: 'T-2',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const failing = vi.fn<FetchLike>(async () => jsonResponse({ ok: false }, 503));
    await expect(uploadLogBundle(baseOptions(failing))).resolves.toEqual({
      ok: false,
      error: '服务器返回 503',
    });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('4xx 或服务器未确认时不重试', async () => {
    const rejected = vi.fn<FetchLike>(async () => jsonResponse({}, 413));
    await expect(uploadLogBundle(baseOptions(rejected))).resolves.toEqual({
      ok: false,
      error: '服务器返回 413',
    });
    expect(rejected).toHaveBeenCalledTimes(1);

    const notOk = vi.fn<FetchLike>(async () => new Response('hello', { status: 200 }));
    await expect(uploadLogBundle(baseOptions(notOk))).resolves.toEqual({
      ok: false,
      error: '服务器未确认接收',
    });
    expect(notOk).toHaveBeenCalledTimes(1);
  });

  it('超时后中止请求并重试', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    await expect(uploadLogBundle({ ...baseOptions(fetchImpl), timeoutMs: 10 })).resolves.toEqual({
      ok: false,
      error: '上传超时',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('超过大小上限时不发请求', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(
      uploadLogBundle({ ...baseOptions(fetchImpl), zip: Buffer.alloc(21 * 1024 * 1024) })
    ).resolves.toEqual({ ok: false, error: '日志包过大' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
