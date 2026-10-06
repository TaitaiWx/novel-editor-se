/**
 * 日志包上传：POST application/zip 到配置的地址（接口约定见 docs/log-upload.md）
 *
 * - 请求头：X-Device-Id / X-App-Version / X-Upload-Reason / X-Platform / X-Bundle-Sha256
 * - 单次请求带超时；网络错误、超时、5xx、429 时重试 1 次，其他 4xx 直接失败
 * - 响应体约定 `{ ok: true, ticketId?: string }`
 */
import { createHash } from 'node:crypto';
import type { LogUploadReason, LogUploadResponse } from '../../shared/log-upload';
import {
  LOG_UPLOAD_RETRIES,
  LOG_UPLOAD_RETRY_DELAY_MS,
  LOG_UPLOAD_TIMEOUT_MS,
  MAX_BUNDLE_BYTES,
} from './config';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface UploadLogBundleOptions {
  endpoint: string;
  zip: Buffer;
  deviceId: string;
  appVersion: string;
  reason: LogUploadReason;
  platform?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export type UploadOutcome = { ok: true; ticketId: string | null } | { ok: false; error: string };

class UploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

async function parseResponse(response: Response): Promise<LogUploadResponse> {
  try {
    const body = (await response.json()) as unknown;
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      return {
        ok: record.ok === true,
        ticketId: typeof record.ticketId === 'string' ? record.ticketId : undefined,
      };
    }
  } catch {
    // 非 JSON 响应按失败处理
  }
  return { ok: false };
}

async function attempt(
  options: UploadLogBundleOptions,
  fetchImpl: FetchLike
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LOG_UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip',
        'X-Device-Id': options.deviceId,
        'X-App-Version': options.appVersion,
        'X-Upload-Reason': options.reason,
        'X-Platform': options.platform ?? `${process.platform}-${process.arch}`,
        'X-Bundle-Sha256': createHash('sha256').update(options.zip).digest('hex'),
      },
      body: new Uint8Array(options.zip),
      signal: controller.signal,
    });
  } catch (error) {
    const message = controller.signal.aborted
      ? '上传超时'
      : `网络错误：${error instanceof Error ? error.message : String(error)}`;
    throw new UploadError(message, true);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new UploadError(`服务器返回 ${response.status}`, isRetryableStatus(response.status));
  }
  const body = await parseResponse(response);
  if (!body.ok) throw new UploadError('服务器未确认接收', false);
  return body.ticketId ?? null;
}

export async function uploadLogBundle(options: UploadLogBundleOptions): Promise<UploadOutcome> {
  if (options.zip.byteLength > MAX_BUNDLE_BYTES) {
    return { ok: false, error: '日志包过大' };
  }
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const retries = options.retries ?? LOG_UPLOAD_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? LOG_UPLOAD_RETRY_DELAY_MS;
  let lastError = '上传失败';
  for (let i = 0; i <= retries; i += 1) {
    try {
      return { ok: true, ticketId: await attempt(options, fetchImpl) };
    } catch (error) {
      const retryable = error instanceof UploadError ? error.retryable : true;
      lastError = error instanceof Error ? error.message : String(error);
      if (!retryable || i === retries) break;
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return { ok: false, error: lastError };
}
