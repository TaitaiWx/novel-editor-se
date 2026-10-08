/**
 * xAI Grok Imagine 视频生成 Provider（异步任务）
 *
 * 文档（2026-10-09 核对）：
 * - REST：https://docs.x.ai/developers/rest-api-reference/inference/videos.md
 * - 指南：https://docs.x.ai/developers/model-capabilities/video/generation.md（声音、分辨率、时长）
 *
 * - 提交：POST {base}/videos/generations
 *     { model, prompt, duration（整数 1–15）, aspect_ratio?, resolution?（480p / 720p / 1080p）,
 *       image?: { url }（首帧，http(s) 或 data URL）, reference_images?: [{ url }]（参考图生视频）,
 *       last_frame?: { url }（尾帧）, generate_audio?: boolean } → { request_id }
 * - 查询：GET {base}/videos/{request_id}
 *     → { status: 'pending' | 'done' | 'failed', progress?, video?: { url, duration, respect_moderation },
 *         error?: { code, message } }
 *   error.code：invalid_argument / permission_denied / failed_precondition / service_unavailable / internal_error
 * - 鉴权 Authorization: Bearer <xAI Key>；HTTP 错误体 { error: "..." } 或 { error: { message, code } }
 *
 * 声音：指南写明生成的视频默认带音轨（grok-imagine-video-1.5 对口型），`generate_audio: false` 生成无声视频；
 * 只有调用方显式传入 withAudio 时才发送。
 *
 * 假设（未写明 / 未联调）：
 * - reference_images 最多 7 张（REST 参考未写上限，取 xAI 指南示例的上限）
 * - 各模型能力不同（2026-10-09 用真实 Key 验证：1.5-lite 报「`reference_images` is not supported for this model」）：
 *   1.5 支持参考图与尾帧；1.5-lite 都不支持；经典 grok-imagine-video 支持参考图、不支持尾帧（GROK_VIDEO_MODEL_FEATURES）。
 *   有首帧时只发首帧（图生视频与参考图生视频是两种模式）。若仍报某字段不支持，去掉该字段重新提交一次
 *   （400 说明任务没有创建，不会重复扣费）
 * - last_frame 字段与 image 同形（REST 参考只在 keyframes 说明中提到，未单独列出）
 * - 完成但 respect_moderation = false 时 url 为空：视为内容安全拦截
 * - 成片地址的有效期未写明，fetchResult 每次重新查询
 */
import { AIError, type AIErrorKind } from '../errors';
import { createHttpClient, NO_RETRY } from '../http';
import type {
  CallOptions,
  ProviderConfig,
  VideoGenerationRequest,
  VideoPollResult,
  VideoProvider,
  VideoResult,
} from '../types';

export const GROK_VIDEO_DEFAULTS = {
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-imagine-video-1.5',
  models: ['grok-imagine-video-1.5', 'grok-imagine-video-1.5-lite', 'grok-imagine-video'],
  timeoutMs: 60_000,
  durationSec: 6,
  maxDurationSec: 15,
} as const;

export const GROK_VIDEO_ENDPOINTS = {
  generations: '/videos/generations',
  result: '/videos',
} as const;

export const GROK_VIDEO_REFERENCE_LIMIT = 7;

const GROK_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']);

/** 我们的分辨率（720p / 768p / 1080p …）→ xAI 支持的档位 */
export function grokVideoResolution(resolution: string | undefined): string | undefined {
  const match = /(\d{3,4})/.exec(resolution ?? '');
  if (!match) return undefined;
  const height = Number(match[1]);
  if (height <= 540) return '480p';
  if (height < 1000) return '720p';
  return '1080p';
}

export function grokVideoDuration(durationSec: number | undefined): number {
  if (durationSec === undefined || !Number.isFinite(durationSec)) {
    return GROK_VIDEO_DEFAULTS.durationSec;
  }
  return Math.min(GROK_VIDEO_DEFAULTS.maxDurationSec, Math.max(1, Math.round(durationSec)));
}

/** 各模型支持的可选输入（未知模型按最完整的 1.5 处理，不支持时由提交重试兜底） */
export const GROK_VIDEO_MODEL_FEATURES: Record<
  string,
  { references: boolean; lastFrame: boolean }
> = {
  'grok-imagine-video-1.5': { references: true, lastFrame: true },
  'grok-imagine-video-1.5-lite': { references: false, lastFrame: false },
  'grok-imagine-video': { references: true, lastFrame: false },
};

function featuresOf(model: string): { references: boolean; lastFrame: boolean } {
  return GROK_VIDEO_MODEL_FEATURES[model] ?? { references: true, lastFrame: true };
}

/** 从「`field` is not supported for this model」这类错误里取出字段名；不是这类错误时为 null */
export function unsupportedGrokField(message: string): string | null {
  const match = /`?([a-z_]+)`?\s+is not supported/i.exec(message);
  return match ? match[1] : null;
}

/** 提交请求体（导出供测试） */
export function buildGrokVideoBody(
  request: VideoGenerationRequest,
  defaultModel: string
): Record<string, unknown> {
  const prompt = request.prompt?.trim() ?? '';
  if (!prompt && !request.firstFrameImage) {
    throw new AIError({
      kind: 'bad-request',
      message: '视频描述不能为空',
      providerId: 'grok-video',
    });
  }
  const body: Record<string, unknown> = {
    model: request.model?.trim() || defaultModel,
    prompt,
    duration: grokVideoDuration(request.durationSec),
  };
  if (request.aspectRatio && GROK_ASPECT_RATIOS.has(request.aspectRatio.trim())) {
    body.aspect_ratio = request.aspectRatio.trim();
  }
  const resolution = grokVideoResolution(request.resolution);
  if (resolution) body.resolution = resolution;
  const features = featuresOf(String(body.model));
  if (request.firstFrameImage) body.image = { url: request.firstFrameImage };
  const references = (request.referenceImages ?? []).slice(0, GROK_VIDEO_REFERENCE_LIMIT);
  // 有首帧时是图生视频，不再带参考图（两种模式）
  if (references.length > 0 && features.references && !request.firstFrameImage) {
    body.reference_images = references.map((url) => ({ url }));
  }
  if (request.lastFrameImage && features.lastFrame) {
    body.last_frame = { url: request.lastFrameImage };
  }
  if (typeof request.withAudio === 'boolean') body.generate_audio = request.withAudio;
  return body;
}

interface GrokVideoStatus {
  status?: string;
  progress?: number | null;
  model?: string | null;
  video?: { url?: string | null; duration?: number; respect_moderation?: boolean } | null;
  error?: { code?: string; message?: string } | null;
}

const ERROR_CODE_KINDS: Record<string, AIErrorKind> = {
  invalid_argument: 'bad-request',
  failed_precondition: 'bad-request',
  permission_denied: 'auth',
  service_unavailable: 'server',
  internal_error: 'server',
};

/** 轮询结果映射（导出供测试） */
export function mapGrokVideoStatus(json: GrokVideoStatus): VideoPollResult {
  const status = (json.status ?? '').toLowerCase();
  if (status === 'failed' || status === 'expired') {
    const code = json.error?.code;
    const error = new AIError({
      kind: (code && ERROR_CODE_KINDS[code]) || 'unknown',
      message: json.error?.message || 'Grok 视频生成失败',
      code,
      providerId: 'grok-video',
      retryable: false,
    });
    return { state: 'failed', error: error.toJSON() };
  }
  if (status === 'done') {
    const url = json.video?.url?.trim();
    if (url) return { state: 'succeeded', progress: 100, resultUrl: url };
    const blocked = json.video?.respect_moderation === false;
    const error = new AIError({
      kind: blocked ? 'content-safety' : 'invalid-response',
      message: blocked ? '生成的视频未通过 xAI 内容审核' : 'Grok 视频已完成但没有返回地址',
      providerId: 'grok-video',
      retryable: false,
    });
    return { state: 'failed', error: error.toJSON() };
  }
  const progress =
    typeof json.progress === 'number' && Number.isFinite(json.progress)
      ? Math.min(99, Math.max(0, json.progress))
      : undefined;
  return progress !== undefined ? { state: 'running', progress } : { state: 'running' };
}

export function createGrokVideoProvider(config: ProviderConfig): VideoProvider {
  const id = 'grok-video';
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({ kind: 'not-configured', message: '未配置 xAI API Key', providerId: id });
  }
  const model = config.model?.trim() || GROK_VIDEO_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || GROK_VIDEO_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? GROK_VIDEO_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  const getStatus = (remoteTaskId: string, call: CallOptions) =>
    client.json<GrokVideoStatus>(
      'GET',
      `${GROK_VIDEO_ENDPOINTS.result}/${encodeURIComponent(remoteTaskId)}`,
      undefined,
      { signal: call.signal }
    );
  return {
    id,
    kind: 'video',
    async submitTask(request, call = {}) {
      const body = buildGrokVideoBody(request, model);
      let json: { request_id?: string; id?: string } | undefined;
      // 模型不支持某个可选字段时去掉它重新提交（最多 3 次；400 说明任务没有创建）
      for (let attempt = 0; ; attempt += 1) {
        try {
          json = await client.json<{ request_id?: string; id?: string }>(
            'POST',
            GROK_VIDEO_ENDPOINTS.generations,
            body,
            { signal: call.signal, retry: NO_RETRY }
          );
          break;
        } catch (error) {
          const field =
            error instanceof AIError && error.kind === 'bad-request'
              ? unsupportedGrokField(error.message)
              : null;
          const optional = field && field !== 'prompt' && field !== 'model' && field in body;
          if (!optional || attempt >= 2) throw error;
          delete body[field];
        }
      }
      const remoteTaskId = json.request_id || json.id;
      if (!remoteTaskId) {
        throw new AIError({
          kind: 'invalid-response',
          message: 'Grok 没有返回任务 id',
          providerId: id,
        });
      }
      return { remoteTaskId };
    },
    async pollTask(remoteTaskId, call = {}) {
      return mapGrokVideoStatus(await getStatus(remoteTaskId, call));
    },
    async fetchResult(remoteTaskId, call = {}): Promise<VideoResult> {
      const poll = mapGrokVideoStatus(await getStatus(remoteTaskId, call));
      if (poll.state !== 'succeeded' || !poll.resultUrl) {
        throw new AIError({
          kind: 'bad-request',
          message: 'Grok 视频任务尚未完成，无法下载',
          providerId: id,
          retryable: true,
        });
      }
      return { url: poll.resultUrl };
    },
    async testConnection(call = {}) {
      await client.json<unknown>('GET', '/models', undefined, { signal: call.signal });
    },
  };
}
