/**
 * 图片生成 Provider：火山方舟 Seedream、MiniMax image-01、xAI Grok 图片
 *
 * 用途：人物形象 / 三视图 / 服装 / 背景图、设定图；参考图用于保持人物一致（场景视频的「不崩」基础）。
 * 接口依据公开文档整理（2026-10），**均未用真实 Key 联调**，地址与字段集中在 *_IMAGE_ENDPOINTS / 构造函数里便于修正：
 *
 * - Seedream（火山方舟）：POST {base}/images/generations
 *     { model, prompt, size, response_format: 'b64_json', watermark: false,
 *       image?: string | string[]（参考图，≤14 张）,
 *       sequential_image_generation?: 'auto', sequential_image_generation_options?: { max_images } }
 *     → { data: [{ b64_json } | { url }] }；错误体 { error: { code, message } }
 * - MiniMax image-01：POST {base}/v1/image_generation
 *     { model, prompt, aspect_ratio, n, response_format: 'base64',
 *       subject_reference?: [{ type: 'character', image_file }]（只取第一张，人脸参考） }
 *     → { data: { image_base64: [...] }, base_resp }（业务错误同视频：HTTP 200 + base_resp.status_code ≠ 0）
 * - xAI Grok：POST {base}/images/generations（OpenAI 兼容）{ model, prompt, n, response_format: 'b64_json' }
 *     → { data: [{ b64_json }] }；生成接口不支持参考图（supportsReferences = false）
 */
import { AIError } from '../errors';
import { createHttpClient, NO_RETRY } from '../http';
import type {
  CallOptions,
  GeneratedImage,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProvider,
  ProviderConfig,
} from '../types';
import { minimaxBaseRespError } from './minimax-video';

export const IMAGE_COUNT_MAX = 4;
const PROMPT_MAX = 1500;

export const SEEDREAM_IMAGE_DEFAULTS = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seedream-4-0-250828',
  models: ['doubao-seedream-4-0-250828', 'doubao-seedream-4-5-251128'],
  timeoutMs: 120_000,
  maxReferences: 10,
} as const;

export const MINIMAX_IMAGE_DEFAULTS = {
  baseUrl: 'https://api.minimax.cn',
  model: 'image-01',
  models: ['image-01'],
  timeoutMs: 120_000,
} as const;

export const GROK_IMAGE_DEFAULTS = {
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-2-image',
  models: ['grok-2-image'],
  timeoutMs: 120_000,
} as const;

export const IMAGE_ENDPOINTS = {
  seedream: '/images/generations',
  minimax: '/v1/image_generation',
  grok: '/images/generations',
} as const;

/** 比例 → Seedream 像素尺寸（2K 档；其他比例按 1:1） */
const SEEDREAM_SIZES: Record<string, string> = {
  '1:1': '2048x2048',
  '3:4': '1728x2304',
  '4:3': '2304x1728',
  '9:16': '1440x2560',
  '16:9': '2560x1440',
  '2:3': '1664x2496',
  '3:2': '2496x1664',
};

export function clampImageCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(IMAGE_COUNT_MAX, Math.max(1, Math.round(count as number)));
}

function trimPrompt(prompt: string): string {
  const text = prompt.trim();
  if (!text) throw new AIError({ kind: 'bad-request', message: '图片描述不能为空' });
  return Array.from(text).slice(0, PROMPT_MAX).join('');
}

function requireKey(config: ProviderConfig, providerId: string, label: string): string {
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({ kind: 'not-configured', message: `未配置${label} API Key`, providerId });
  }
  return apiKey;
}

interface OpenAIImageData {
  data?: Array<{ b64_json?: string; url?: string }>;
}

function mapOpenAIImages(json: OpenAIImageData, providerId: string): GeneratedImage[] {
  const images = (json.data ?? [])
    .map((item): GeneratedImage | null =>
      item.b64_json
        ? { base64: item.b64_json, mimeType: 'image/png' }
        : item.url
          ? { url: item.url, mimeType: 'image/png' }
          : null
    )
    .filter((item): item is GeneratedImage => item !== null);
  if (images.length === 0) {
    throw new AIError({ kind: 'invalid-response', message: '没有返回图片', providerId });
  }
  return images;
}

// ─── Seedream ───────────────────────────────────────────────────────────

export function buildSeedreamImageBody(
  request: ImageGenerationRequest,
  defaultModel: string
): Record<string, unknown> {
  const count = clampImageCount(request.count);
  const body: Record<string, unknown> = {
    model: request.model?.trim() || defaultModel,
    prompt: trimPrompt(request.prompt),
    size: SEEDREAM_SIZES[request.aspectRatio ?? '1:1'] ?? SEEDREAM_SIZES['1:1'],
    response_format: 'b64_json',
    watermark: false,
  };
  const references = (request.referenceImages ?? []).slice(
    0,
    SEEDREAM_IMAGE_DEFAULTS.maxReferences
  );
  if (references.length === 1) body.image = references[0];
  else if (references.length > 1) body.image = references;
  if (count > 1) {
    body.sequential_image_generation = 'auto';
    body.sequential_image_generation_options = { max_images: count };
  }
  if (request.seed !== undefined) body.seed = request.seed;
  return body;
}

export function createSeedreamImageProvider(config: ProviderConfig): ImageProvider {
  const id = 'seedream-image';
  const apiKey = requireKey(config, id, '火山方舟');
  const model = config.model?.trim() || SEEDREAM_IMAGE_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || SEEDREAM_IMAGE_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? SEEDREAM_IMAGE_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  return {
    id,
    kind: 'image',
    supportsReferences: true,
    async generate(request, call: CallOptions = {}): Promise<ImageGenerationResult> {
      const body = buildSeedreamImageBody(request, model);
      const json = await client.json<OpenAIImageData>('POST', IMAGE_ENDPOINTS.seedream, body, {
        signal: call.signal,
        retry: NO_RETRY,
      });
      return { images: mapOpenAIImages(json, id), model: String(body.model) };
    },
    async testConnection(call: CallOptions = {}) {
      // 方舟没有免费的图片探活接口：列出模型验证 Key 与地址
      await client.json<unknown>('GET', '/models', undefined, { signal: call.signal });
    },
  };
}

// ─── MiniMax image-01 ───────────────────────────────────────────────────

interface MinimaxImageResponse {
  data?: { image_base64?: string[]; image_urls?: string[] };
  base_resp?: { status_code?: number; status_msg?: string };
}

export function buildMinimaxImageBody(
  request: ImageGenerationRequest,
  defaultModel: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model?.trim() || defaultModel,
    prompt: trimPrompt(request.prompt),
    aspect_ratio: request.aspectRatio ?? '1:1',
    n: clampImageCount(request.count),
    response_format: 'base64',
    prompt_optimizer: true,
  };
  const reference = request.referenceImages?.[0];
  if (reference) body.subject_reference = [{ type: 'character', image_file: reference }];
  if (request.seed !== undefined) body.seed = request.seed;
  return body;
}

export function createMinimaxImageProvider(config: ProviderConfig): ImageProvider {
  const id = 'minimax-image';
  const apiKey = requireKey(config, id, 'MiniMax');
  const model = config.model?.trim() || MINIMAX_IMAGE_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || MINIMAX_IMAGE_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? MINIMAX_IMAGE_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  const run = async (body: Record<string, unknown>, call: CallOptions) => {
    const json = await client.json<MinimaxImageResponse>('POST', IMAGE_ENDPOINTS.minimax, body, {
      signal: call.signal,
      retry: NO_RETRY,
    });
    const error = minimaxBaseRespError(json.base_resp);
    if (error) throw new AIError({ ...error.toJSON(), providerId: id });
    return json;
  };
  return {
    id,
    kind: 'image',
    supportsReferences: true,
    async generate(request, call: CallOptions = {}) {
      const body = buildMinimaxImageBody(request, model);
      const json = await run(body, call);
      const images: GeneratedImage[] = [
        ...(json.data?.image_base64 ?? []).map((base64) => ({ base64, mimeType: 'image/jpeg' })),
        ...(json.data?.image_urls ?? []).map((url) => ({ url, mimeType: 'image/jpeg' })),
      ];
      if (images.length === 0) {
        throw new AIError({ kind: 'invalid-response', message: '没有返回图片', providerId: id });
      }
      return { images, model: String(body.model) };
    },
    async testConnection(call: CallOptions = {}) {
      // 没有免费的探活接口：用一张最小图片验证（会产生极少量费用，设置中心会提示）
      await run(buildMinimaxImageBody({ prompt: 'a dot', count: 1 }, model), call);
    },
  };
}

// ─── xAI Grok ───────────────────────────────────────────────────────────

export function buildGrokImageBody(
  request: ImageGenerationRequest,
  defaultModel: string
): Record<string, unknown> {
  return {
    model: request.model?.trim() || defaultModel,
    prompt: trimPrompt(request.prompt),
    n: clampImageCount(request.count),
    response_format: 'b64_json',
  };
}

export function createGrokImageProvider(config: ProviderConfig): ImageProvider {
  const id = 'grok-image';
  const apiKey = requireKey(config, id, 'xAI');
  const model = config.model?.trim() || GROK_IMAGE_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || GROK_IMAGE_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? GROK_IMAGE_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  return {
    id,
    kind: 'image',
    supportsReferences: false,
    async generate(request, call: CallOptions = {}) {
      const body = buildGrokImageBody(request, model);
      const json = await client.json<OpenAIImageData>('POST', IMAGE_ENDPOINTS.grok, body, {
        signal: call.signal,
        retry: NO_RETRY,
      });
      return { images: mapOpenAIImages(json, id), model: String(body.model) };
    },
    async testConnection(call: CallOptions = {}) {
      await client.json<unknown>('GET', '/models', undefined, { signal: call.signal });
    },
  };
}
