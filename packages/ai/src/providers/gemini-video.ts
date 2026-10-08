/**
 * Google Gemini Omni Flash 视频生成 Provider（Interactions API，后台执行）
 *
 * 文档（2026-10-09 核对）：
 * - Omni：https://ai.google.dev/gemini-api/docs/omni
 * - 后台执行：https://ai.google.dev/gemini-api/docs/background-execution
 * Veo 3.1 将于 2026-10-22 下线，不再实现。
 *
 * - 提交：POST {base}/interactions（鉴权头 x-goog-api-key）
 *     { model, input: 提示词 | [{ type: 'image', data, mime_type }, { type: 'text', text }],
 *       response_format: { type: 'video', aspect_ratio: '16:9' | '9:16', resolution: '720p' | '1080p', delivery: 'uri' },
 *       background: true } → { id, status: 'in_progress' … }
 * - 查询：GET {base}/interactions/{id} → { id, status: in_progress | requires_action | completed | failed | cancelled,
 *     steps: [{ type: 'model_output', content: [{ type: 'video', mime_type, uri? | data? }] }], error? }
 * - 取消：POST {base}/interactions/{id}/cancel
 * - 成片总是带声音（Omni 原生生成音画），忽略 withAudio
 *
 * 未联调（Key 余额不足，2026-10-09 实测只拿到 402）。文档未写明 / 有出入的地方，解析尽量宽松：
 * - 文档提示：GET 查询时即使请求了 delivery: 'uri'，视频也可能以内联 base64（data 字段）返回，uri 只保证出现在创建响应里。
 *   因此结果按顺序取：uri（Google 托管地址，下载要带 Key 头）→ files/xxx 引用（拼成 {base}/files/xxx:download?alt=media）
 *   → 内联 data（返回 data: URL，调用方的下载器需支持 data: 地址；Node / Electron 的 fetch 支持）
 * - 视频项可能出现在 steps[].content[]、outputs[]、output_video 中，字段名可能是 uri / file_uri / file / name / data
 * - 任务失败时 error 为 { code, message }，code 映射：payment_required → quota，safety / image_safety → content-safety，
 *   rate_limit_exceeded → rate-limit，authentication → auth
 * - 下载请求头 { 'x-goog-api-key': Key } 由 fetchResult 返回（只在地址与接口同一主机、https 时附带）：
 *   **调用方不得持久化或写入日志**
 */
import { AIError, classifyHttpError, type AIErrorKind } from '../errors';
import { NO_RETRY } from '../http';
import type {
  CallOptions,
  ProviderConfig,
  VideoGenerationRequest,
  VideoPollResult,
  VideoProvider,
  VideoResult,
} from '../types';
import { createGeminiClient, GEMINI_BASE_URL, geminiModelPath, parseDataUrl } from './gemini';

export const GEMINI_VIDEO_DEFAULTS = {
  baseUrl: GEMINI_BASE_URL,
  model: 'gemini-omni-1.1-flash',
  models: ['gemini-omni-1.1-flash'],
  timeoutMs: 120_000,
} as const;

export const GEMINI_VIDEO_ENDPOINTS = { interactions: '/interactions' } as const;

const PROMPT_MAX = 4000;

/** 竖版比例（宽 < 高）→ 9:16，其他 → 16:9 */
export function geminiVideoAspectRatio(aspectRatio: string | undefined): '16:9' | '9:16' {
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(aspectRatio ?? '');
  if (!match) return '16:9';
  return Number(match[1]) < Number(match[2]) ? '9:16' : '16:9';
}

export function geminiVideoResolution(resolution: string | undefined): '720p' | '1080p' {
  const match = /(\d{3,4})/.exec(resolution ?? '');
  return match && Number(match[1]) >= 1000 ? '1080p' : '720p';
}

export function buildGeminiVideoBody(
  request: VideoGenerationRequest,
  defaultModel: string
): Record<string, unknown> {
  const prompt = Array.from(request.prompt?.trim() ?? '')
    .slice(0, PROMPT_MAX)
    .join('');
  const frame = request.firstFrameImage ? parseDataUrl(request.firstFrameImage) : null;
  if (!prompt && !frame) {
    throw new AIError({
      kind: 'bad-request',
      message: '视频描述不能为空',
      providerId: 'gemini-video',
    });
  }
  const input: unknown = frame
    ? [
        { type: 'image', data: frame.data, mime_type: frame.mimeType },
        ...(prompt ? [{ type: 'text', text: prompt }] : []),
      ]
    : prompt;
  return {
    model: request.model?.trim() || defaultModel,
    input,
    response_format: {
      type: 'video',
      aspect_ratio: geminiVideoAspectRatio(request.aspectRatio),
      resolution: geminiVideoResolution(request.resolution),
      delivery: 'uri',
    },
    background: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface GeminiVideoOutput {
  uri?: string;
  /** files/xxx 形式的文件引用 */
  file?: string;
  data?: string;
  mimeType: string;
}

function toVideoOutput(item: Record<string, unknown>): GeminiVideoOutput | null {
  const type = str(item.type)?.toLowerCase();
  const mimeType = str(item.mime_type) ?? str(item.mimeType) ?? '';
  if (type !== 'video' && !mimeType.startsWith('video/')) return null;
  const uri = str(item.uri) ?? str(item.file_uri) ?? str(item.fileUri) ?? str(item.url);
  const fileRef = str(item.file) ?? str(item.name) ?? str(item.file_id);
  const data = str(item.data);
  if (!uri && !fileRef && !data) return null;
  return {
    ...(uri ? { uri } : {}),
    ...(fileRef ? { file: fileRef } : {}),
    ...(data ? { data } : {}),
    mimeType: mimeType || 'video/mp4',
  };
}

/** 在交互结果里找视频输出（宽松：steps[].content[] / outputs[] / output_video） */
export function extractGeminiVideo(json: unknown): GeminiVideoOutput | null {
  if (!isRecord(json)) return null;
  const candidates: unknown[] = [];
  if (isRecord(json.output_video)) candidates.push(json.output_video);
  if (isRecord(json.outputVideo)) candidates.push(json.outputVideo);
  for (const key of ['steps', 'outputs', 'output']) {
    const list = json[key];
    if (!Array.isArray(list)) continue;
    // 从后往前找：模型输出在最后
    for (const entry of [...list].reverse()) {
      if (!isRecord(entry)) continue;
      candidates.push(entry);
      const content = entry.content;
      if (Array.isArray(content)) candidates.push(...[...content].reverse());
    }
  }
  for (const item of candidates) {
    if (!isRecord(item)) continue;
    const output = toVideoOutput(item);
    if (output) return output;
  }
  return null;
}

const ERROR_CODE_KINDS: Record<string, AIErrorKind> = {
  payment_required: 'quota',
  safety: 'content-safety',
  image_safety: 'content-safety',
  rate_limit_exceeded: 'rate-limit',
  authentication: 'auth',
};

interface GeminiInteraction {
  id?: string;
  name?: string;
  status?: string;
  error?: { code?: string | number; message?: string; status?: string } | string | null;
}

export function mapGeminiVideoInteraction(json: GeminiInteraction): VideoPollResult {
  const status = (json.status ?? '').toLowerCase();
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    const raw = json.error;
    const message =
      (typeof raw === 'string' ? raw : raw?.message) ||
      (status === 'failed' ? 'Gemini 视频生成失败' : 'Gemini 视频任务已取消');
    const codeValue = typeof raw === 'object' && raw ? (raw.code ?? raw.status) : undefined;
    const code = codeValue !== undefined ? String(codeValue) : undefined;
    const mapped = code ? ERROR_CODE_KINDS[code.toLowerCase()] : undefined;
    const guessed = classifyHttpError(0, message, code);
    const error = new AIError({
      kind: mapped ?? (guessed === 'bad-request' ? 'unknown' : guessed),
      message,
      ...(code ? { code } : {}),
      providerId: 'gemini-video',
      retryable: false,
    });
    return { state: 'failed', error: error.toJSON() };
  }
  if (status === 'completed') {
    if (extractGeminiVideo(json)) return { state: 'succeeded', progress: 100 };
    const error = new AIError({
      kind: 'invalid-response',
      message: 'Gemini 视频已完成但没有返回视频',
      providerId: 'gemini-video',
      retryable: false,
    });
    return { state: 'failed', error: error.toJSON() };
  }
  return { state: 'running' };
}

/** 视频输出 → 下载地址（导出供测试） */
export function geminiVideoDownloadUrl(output: GeminiVideoOutput, baseUrl: string): string {
  if (output.uri) {
    if (/^https?:\/\//i.test(output.uri)) return output.uri;
    return geminiFileDownloadUrl(output.uri, baseUrl);
  }
  if (output.file) return geminiFileDownloadUrl(output.file, baseUrl);
  return `data:${output.mimeType};base64,${output.data ?? ''}`;
}

function geminiFileDownloadUrl(ref: string, baseUrl: string): string {
  const fileId = ref
    .replace(/^\/+/, '')
    .replace(/^files\//, '')
    .replace(/:download.*$/, '');
  return `${baseUrl.replace(/\/+$/, '')}/files/${encodeURIComponent(fileId)}:download?alt=media`;
}

function sameHost(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url);
    return target.protocol === 'https:' && target.host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

export function createGeminiVideoProvider(config: ProviderConfig): VideoProvider {
  const id = 'gemini-video';
  const { client, apiKey, baseUrl } = createGeminiClient(config, id, GEMINI_VIDEO_DEFAULTS);
  const model = config.model?.trim() || GEMINI_VIDEO_DEFAULTS.model;
  const interactionPath = (remoteTaskId: string) =>
    `${GEMINI_VIDEO_ENDPOINTS.interactions}/${encodeURIComponent(remoteTaskId.replace(/^interactions\//, ''))}`;
  const getInteraction = (remoteTaskId: string, call: CallOptions) =>
    client.json<GeminiInteraction>('GET', interactionPath(remoteTaskId), undefined, {
      signal: call.signal,
    });
  return {
    id,
    kind: 'video',
    async submitTask(request, call = {}) {
      const json = await client.json<GeminiInteraction>(
        'POST',
        GEMINI_VIDEO_ENDPOINTS.interactions,
        buildGeminiVideoBody(request, model),
        { signal: call.signal, retry: NO_RETRY }
      );
      const remoteTaskId = json.id || json.name;
      if (!remoteTaskId) {
        throw new AIError({
          kind: 'invalid-response',
          message: 'Gemini 没有返回任务 id',
          providerId: id,
        });
      }
      return { remoteTaskId };
    },
    async pollTask(remoteTaskId, call = {}) {
      return mapGeminiVideoInteraction(await getInteraction(remoteTaskId, call));
    },
    async fetchResult(remoteTaskId, call = {}): Promise<VideoResult> {
      const json = await getInteraction(remoteTaskId, call);
      const output =
        mapGeminiVideoInteraction(json).state === 'succeeded' ? extractGeminiVideo(json) : null;
      if (!output) {
        throw new AIError({
          kind: 'bad-request',
          message: 'Gemini 视频任务尚未完成，无法下载',
          providerId: id,
          retryable: true,
        });
      }
      const url = geminiVideoDownloadUrl(output, baseUrl);
      // 只给 Gemini 接口同一主机的地址附带 Key（data: 地址、第三方地址不带，避免泄露）
      return sameHost(url, baseUrl) ? { url, headers: { 'x-goog-api-key': apiKey } } : { url };
    },
    async cancelTask(remoteTaskId, call = {}) {
      await client
        .json<unknown>(
          'POST',
          `${interactionPath(remoteTaskId)}/cancel`,
          {},
          {
            signal: call.signal,
            retry: NO_RETRY,
          }
        )
        .catch((error: unknown) => {
          if (error instanceof AIError && error.kind === 'invalid-response') return;
          throw error;
        });
    },
    async testConnection(call = {}) {
      await client.json<unknown>('GET', geminiModelPath(model), undefined, { signal: call.signal });
    },
  };
}
