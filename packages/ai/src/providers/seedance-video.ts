/**
 * Seedance（字节跳动 · 火山引擎方舟 Ark）视频生成 Provider
 *
 * 接口（依据火山方舟「视频生成 API」公开文档，2026-10 核对）：
 * - 提交：POST {base}/contents/generations/tasks
 *     { model, content: [{ type: 'text', text }, { type: 'image_url', image_url: { url }, role: 'first_frame' }],
 *       ratio?, duration?, resolution?, watermark?, seed? } → { id }
 * - 查询：GET {base}/contents/generations/tasks/{id}
 *     → { id, status: queued|running|succeeded|failed|cancelled|expired, content: { video_url }, error?: { code, message } }
 * - 取消：DELETE {base}/contents/generations/tasks/{id}（仅排队中的任务）
 * - 列表：GET {base}/contents/generations/tasks?page_num=1&page_size=1（用于测试连接）
 * - 鉴权：Authorization: Bearer <方舟 API Key>；错误体 { error: { code, message } }
 *   （例如 AuthenticationError、InputTextSensitiveContentDetected、AccountOverdueError）
 *
 * 假设（集中在常量里便于修正）：
 * - 默认地址为华北 2（北京）https://ark.cn-beijing.volces.com/api/v3
 * - 新版模型支持把 ratio / duration / resolution / watermark / seed 放在请求体顶层；
 *   旧版 1.0 模型只认文本命令（`--ratio 16:9 --duration 5 …` 追加在提示词后），
 *   通过 paramStyle 切换，默认 'body'
 * - 成片地址为 24 小时有效的签名地址，fetchResult 每次重新查询
 */
import { AIError, classifyHttpError } from '../errors';
import { createHttpClient, NO_RETRY } from '../http';
import type {
  CallOptions,
  ProviderConfig,
  VideoGenerationRequest,
  VideoPollResult,
  VideoProvider,
  VideoResult,
} from '../types';

export const SEEDANCE_VIDEO_DEFAULTS = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seedance-1-0-pro-250528',
  models: [
    'doubao-seedance-1-0-pro-250528',
    'doubao-seedance-1-0-lite-t2v-250428',
    'doubao-seedance-1-0-lite-i2v-250428',
    'doubao-seedance-2-0-fast-260128',
  ],
  timeoutMs: 60_000,
} as const;

export const SEEDANCE_REFERENCE_LIMIT = 4;

export const SEEDANCE_ENDPOINTS = {
  tasks: '/contents/generations/tasks',
} as const;

export type SeedanceParamStyle = 'body' | 'text-command';

interface SeedanceTask {
  id?: string;
  status?: string;
  content?: { video_url?: string };
  error?: { code?: string; message?: string } | null;
}

/** 构造提交请求体（导出供测试做请求映射快照） */
export function buildSeedanceSubmitBody(
  request: VideoGenerationRequest,
  defaultModel: string,
  paramStyle: SeedanceParamStyle = 'body'
): Record<string, unknown> {
  const params: Array<[string, string | number | boolean]> = [];
  if (request.aspectRatio) params.push(['ratio', request.aspectRatio]);
  if (request.durationSec !== undefined && Number.isFinite(request.durationSec)) {
    params.push(['duration', Math.max(1, Math.round(request.durationSec))]);
  }
  if (request.resolution) params.push(['resolution', request.resolution.toLowerCase()]);
  if (request.watermark !== undefined) params.push(['watermark', request.watermark]);
  if (request.seed !== undefined) params.push(['seed', request.seed]);

  const text =
    paramStyle === 'text-command' && params.length
      ? `${request.prompt} ${params.map(([key, value]) => `--${key} ${String(value)}`).join(' ')}`
      : request.prompt;
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }];
  if (request.firstFrameImage) {
    content.push({
      type: 'image_url',
      image_url: { url: request.firstFrameImage },
      role: 'first_frame',
    });
  }
  if (request.lastFrameImage) {
    content.push({
      type: 'image_url',
      image_url: { url: request.lastFrameImage },
      role: 'last_frame',
    });
  }
  // 人物参考图（role: reference_image，Seedance 2.0 起支持，最多 9 张；未用真实 Key 联调）
  for (const url of (request.referenceImages ?? []).slice(0, SEEDANCE_REFERENCE_LIMIT)) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  }
  const body: Record<string, unknown> = {
    model: request.model?.trim() || defaultModel,
    content,
  };
  if (paramStyle === 'body') {
    for (const [key, value] of params) body[key] = value;
  }
  return body;
}

export function mapSeedanceStatus(status: string | undefined): VideoPollResult['state'] {
  switch ((status ?? '').toLowerCase()) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'cancelled':
    case 'canceled':
    case 'expired':
      return 'failed';
    case 'running':
      return 'running';
    default:
      return 'queued';
  }
}

function taskError(task: SeedanceTask): AIError {
  const message =
    task.error?.message ||
    (task.status === 'expired' ? 'Seedance 任务已过期' : 'Seedance 视频生成失败');
  const kind = classifyHttpError(0, message, task.error?.code);
  return new AIError({
    kind: kind === 'bad-request' ? 'unknown' : kind,
    message,
    code: task.error?.code,
    providerId: 'seedance-video',
    retryable: false,
  });
}

export interface SeedanceProviderOptions extends ProviderConfig {
  paramStyle?: SeedanceParamStyle;
}

export function createSeedanceVideoProvider(config: SeedanceProviderOptions): VideoProvider {
  const id = 'seedance-video';
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({
      kind: 'not-configured',
      message: '未配置火山方舟 API Key',
      providerId: id,
    });
  }
  const model = config.model?.trim() || SEEDANCE_VIDEO_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || SEEDANCE_VIDEO_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? SEEDANCE_VIDEO_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  const taskPath = (remoteTaskId: string) =>
    `${SEEDANCE_ENDPOINTS.tasks}/${encodeURIComponent(remoteTaskId)}`;
  const getTask = (remoteTaskId: string, call: CallOptions) =>
    client.json<SeedanceTask>('GET', taskPath(remoteTaskId), undefined, { signal: call.signal });

  return {
    id,
    kind: 'video',
    async submitTask(request, call = {}) {
      const json = await client.json<SeedanceTask>(
        'POST',
        SEEDANCE_ENDPOINTS.tasks,
        buildSeedanceSubmitBody(request, model, config.paramStyle),
        { signal: call.signal, retry: NO_RETRY }
      );
      if (!json.id) {
        throw new AIError({
          kind: 'invalid-response',
          message: 'Seedance 没有返回任务 id',
          providerId: id,
        });
      }
      return { remoteTaskId: json.id };
    },
    async pollTask(remoteTaskId, call = {}): Promise<VideoPollResult> {
      const task = await getTask(remoteTaskId, call);
      const state = mapSeedanceStatus(task.status);
      if (state === 'failed') return { state, error: taskError(task).toJSON() };
      if (state === 'succeeded' && task.content?.video_url) {
        return { state, progress: 100, resultUrl: task.content.video_url };
      }
      return { state };
    },
    async fetchResult(remoteTaskId, call = {}): Promise<VideoResult> {
      const task = await getTask(remoteTaskId, call);
      const url = task.content?.video_url;
      if (mapSeedanceStatus(task.status) !== 'succeeded' || !url) {
        throw new AIError({
          kind: 'bad-request',
          message: 'Seedance 任务尚未完成，无法下载',
          providerId: id,
          retryable: true,
        });
      }
      return { url, expiresAt: Date.now() + 24 * 3600 * 1000 };
    },
    async cancelTask(remoteTaskId, call = {}) {
      await client
        .json<unknown>('DELETE', taskPath(remoteTaskId), undefined, {
          signal: call.signal,
          retry: NO_RETRY,
        })
        .catch((error: unknown) => {
          // DELETE 成功时可能返回空体，视为成功
          if (error instanceof AIError && error.kind === 'invalid-response') return;
          throw error;
        });
    },
    async testConnection(call = {}) {
      await client.json<unknown>('GET', SEEDANCE_ENDPOINTS.tasks, undefined, {
        signal: call.signal,
        retry: NO_RETRY,
        query: { page_num: 1, page_size: 1 },
      });
    },
  };
}
