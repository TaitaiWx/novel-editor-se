/**
 * OpenAI 图片生成 Provider（GPT Image 系列）
 *
 * 文档（2026-10-09 核对）：
 * - 生成：https://developers.openai.com/api/reference/resources/images/methods/generate
 * - 编辑（参考图）：https://developers.openai.com/api/reference/resources/images/methods/edit
 *
 * - 文生图：POST {base}/images/generations
 *     { model, prompt, n, size, quality?, output_format: 'png' } → { data: [{ b64_json }] }
 *   GPT Image 模型只返回 base64，不返回地址；**不发送** response_format / style（只属于 DALL·E，GPT Image 会拒绝）
 * - 参考图：POST {base}/images/edits（JSON 形式）
 *     { model, prompt, images: [{ image_url }], n, size, output_format } → 同上
 * - 尺寸：1:1 → 1024x1024，竖版（3:4 / 2:3 / 9:16 / 4:5）→ 1024x1536，横版（4:3 / 3:2 / 16:9 / 5:4）→ 1536x1024，
 *   其他比例 → auto
 * - 错误体 { error: { message, code, type } }；内容审核拦截 code = 'moderation_blocked' → content-safety
 *
 * 假设（文档未写明或未用真实 Key 联调的部分）：
 * - edits 的 JSON 形式接受 data URL 与 https 地址作为 image_url（文档写明 JSON 请求可用 image_url）
 * - quality 只在调用方需要时发送（目前请求里没有该字段，保持厂商默认 auto）
 * - testConnection 用 GET {base}/models 验证 Key 与地址（不产生费用）
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
import { clampImageCount } from './image';

export const OPENAI_IMAGE_DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-image-2',
  models: ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
  timeoutMs: 180_000,
  maxReferences: 10,
} as const;

export const OPENAI_IMAGE_ENDPOINTS = {
  generations: '/images/generations',
  edits: '/images/edits',
} as const;

const PROMPT_MAX = 4000;
const PORTRAIT = new Set(['3:4', '2:3', '9:16', '4:5']);
const LANDSCAPE = new Set(['4:3', '3:2', '16:9', '5:4']);

/** 比例 → OpenAI 图片尺寸 */
export function openAIImageSize(aspectRatio: string | undefined): string {
  const ratio = (aspectRatio ?? '1:1').trim();
  if (ratio === '1:1') return '1024x1024';
  if (PORTRAIT.has(ratio)) return '1024x1536';
  if (LANDSCAPE.has(ratio)) return '1536x1024';
  return 'auto';
}

function trimPrompt(prompt: string): string {
  const text = prompt.trim();
  if (!text) {
    throw new AIError({
      kind: 'bad-request',
      message: '图片描述不能为空',
      providerId: 'openai-image',
    });
  }
  return Array.from(text).slice(0, PROMPT_MAX).join('');
}

/** 请求体（有参考图时为 /images/edits 的 JSON 形式），导出供测试 */
export function buildOpenAIImageBody(
  request: ImageGenerationRequest & { quality?: string },
  defaultModel: string
): { endpoint: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = {
    model: request.model?.trim() || defaultModel,
    prompt: trimPrompt(request.prompt),
    n: clampImageCount(request.count),
    size: openAIImageSize(request.aspectRatio),
    output_format: 'png',
  };
  if (request.quality) body.quality = request.quality;
  const references = (request.referenceImages ?? [])
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, OPENAI_IMAGE_DEFAULTS.maxReferences);
  if (references.length === 0) return { endpoint: OPENAI_IMAGE_ENDPOINTS.generations, body };
  body.images = references.map((image_url) => ({ image_url }));
  return { endpoint: OPENAI_IMAGE_ENDPOINTS.edits, body };
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  output_format?: string;
}

export function parseOpenAIImageResponse(json: OpenAIImageResponse): GeneratedImage[] {
  const mimeType = `image/${json.output_format === 'jpeg' || json.output_format === 'webp' ? json.output_format : 'png'}`;
  const images = (json.data ?? [])
    .map((item): GeneratedImage | null =>
      item.b64_json
        ? { base64: item.b64_json, mimeType }
        : item.url
          ? { url: item.url, mimeType }
          : null
    )
    .filter((item): item is GeneratedImage => item !== null);
  if (images.length === 0) {
    throw new AIError({
      kind: 'invalid-response',
      message: '没有返回图片',
      providerId: 'openai-image',
    });
  }
  return images;
}

export function createOpenAIImageProvider(config: ProviderConfig): ImageProvider {
  const id = 'openai-image';
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({ kind: 'not-configured', message: '未配置 OpenAI API Key', providerId: id });
  }
  const model = config.model?.trim() || OPENAI_IMAGE_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || OPENAI_IMAGE_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? OPENAI_IMAGE_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  return {
    id,
    kind: 'image',
    supportsReferences: true,
    async generate(request, call: CallOptions = {}): Promise<ImageGenerationResult> {
      const { endpoint, body } = buildOpenAIImageBody(request, model);
      const json = await client.json<OpenAIImageResponse>('POST', endpoint, body, {
        signal: call.signal,
        retry: NO_RETRY,
      });
      return { images: parseOpenAIImageResponse(json), model: String(body.model) };
    },
    async testConnection(call: CallOptions = {}) {
      await client.json<unknown>('GET', '/models', undefined, { signal: call.signal });
    },
  };
}
