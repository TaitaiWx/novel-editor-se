/**
 * Google Gemini 原生接口：图片生成（Nano Banana 系列）与语音生成（TTS）
 *
 * 文档（2026-10-09 核对）：
 * - 图片：https://ai.google.dev/gemini-api/docs/generate-content/image-generation
 * - 语音：https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
 *
 * 共同点：POST {base}/models/{model}:generateContent，鉴权头 `x-goog-api-key: <Key>`（不是 Bearer）；
 * 错误体 { error: { code, message, status } }（429 RESOURCE_EXHAUSTED 限流、402 预付费额度用完、403 无权限…，
 * 由 errors.ts 按状态码 + 信息规范化）。testConnection：GET {base}/models/{model}（不产生费用）。
 *
 * - 图片：{ contents: [{ role: 'user', parts: [{ text }, { inline_data: { mime_type, data } }…] }],
 *     generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } } }
 *   → candidates[0].content.parts[].inlineData { mimeType, data }（兼容 inline_data 蛇形写法）。
 *   每次请求只出一张图，count > 1 时依次请求。没有图片时按 finishReason 判断
 *   （IMAGE_SAFETY / IMAGE_PROHIBITED_CONTENT / SAFETY / PROHIBITED_CONTENT → 内容安全）
 * - 语音：{ contents: [{ role: 'user', parts: [{ text }] }],
 *     generationConfig: { responseModalities: ['AUDIO'],
 *       speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } }, languageCode } } }
 *   → candidates[0].content.parts[0].inlineData.data：base64 的 PCM（s16le、24kHz、单声道，
 *   mimeType 形如 audio/L16;codec=pcm;rate=24000），这里补上 44 字节 WAV 头后按 wav 保存
 *
 * 假设（Key 余额不足，2026-10-09 实测只拿到 402，**未完成联调**）：
 * - 参考图只发送 data URL（inline_data）；http(s) 地址需要先上传到 Files API，这里跳过
 * - 情绪没有单独参数：用自然语言朗读指令前缀（例如 `Say in a sad tone: `），文档示例即此写法
 * - 返回的音频若已是 WAV（以 RIFF 开头）则原样使用
 */
import { emotionValue } from '@novel-editor/video';
import { AIError } from '../errors';
import { createHttpClient, NO_RETRY, type HttpClient } from '../http';
import type {
  CallOptions,
  GeneratedImage,
  ImageGenerationRequest,
  ImageProvider,
  ProviderConfig,
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
} from '../types';
import { clampImageCount } from './image';
import { base64ToBytes, SPEECH_TEXT_MAX, toSpeechResult } from './speech';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_IMAGE_DEFAULTS = {
  baseUrl: GEMINI_BASE_URL,
  model: 'gemini-nano-banana-2.1',
  models: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image'],
  timeoutMs: 180_000,
  maxReferences: 10,
} as const;

export const GEMINI_SPEECH_DEFAULTS = {
  baseUrl: GEMINI_BASE_URL,
  model: 'gemini-3.8-flash-tts',
  models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
  timeoutMs: 120_000,
  sampleRate: 24000,
  voices: { female: 'Kore', male: 'Charon', neutral: 'Puck' },
} as const;

/** 预置音色（全部支持多语种） */
export const GEMINI_SPEECH_VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;

const GEMINI_ASPECT_RATIOS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);

const IMAGE_SAFETY_REASONS = new Set([
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
]);

const PROMPT_MAX = 4000;

export function geminiModelPath(model: string, action?: string): string {
  const name = model.replace(/^models\//, '');
  return `/models/${encodeURIComponent(name)}${action ? `:${action}` : ''}`;
}

/** Gemini 客户端：x-goog-api-key 鉴权（Gemini 视频也使用） */
export function createGeminiClient(
  config: ProviderConfig,
  providerId: string,
  defaults: { baseUrl: string; timeoutMs: number }
): { client: HttpClient; apiKey: string; baseUrl: string } {
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({ kind: 'not-configured', message: '未配置 Gemini API Key', providerId });
  }
  const baseUrl = config.baseUrl?.trim() || defaults.baseUrl;
  const client = createHttpClient({
    providerId,
    baseUrl,
    headers: { 'x-goog-api-key': apiKey },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? defaults.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  return { client, apiKey, baseUrl };
}

/** data URL → { mimeType, data }；不是 base64 data URL 时返回 null */
export function parseDataUrl(value: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+)[^,]*;base64,(.+)$/is.exec(value.trim());
  if (!match) return null;
  return { mimeType: (match[1] ?? '').toLowerCase(), data: match[2] ?? '' };
}

interface GeminiInlineData {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

export interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
    finish_reason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

function inlineParts(json: GeminiGenerateResponse): Array<{ mimeType: string; data: string }> {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const result: Array<{ mimeType: string; data: string }> = [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      result.push({ mimeType: inline.mimeType ?? inline.mime_type ?? '', data: inline.data });
    }
  }
  return result;
}

function noOutputError(json: GeminiGenerateResponse, providerId: string, what: string): AIError {
  const candidate = json.candidates?.[0];
  const reason =
    candidate?.finishReason ?? candidate?.finish_reason ?? json.promptFeedback?.blockReason;
  if (reason && IMAGE_SAFETY_REASONS.has(reason.toUpperCase())) {
    return new AIError({
      kind: 'content-safety',
      message: `内容被 Gemini 的安全策略拦截（${reason}）`,
      code: reason,
      providerId,
    });
  }
  return new AIError({
    kind: 'invalid-response',
    message: `Gemini 没有返回${what}${reason ? `（${reason}）` : ''}`,
    ...(reason ? { code: reason } : {}),
    providerId,
  });
}

// ─── 图片 ───────────────────────────────────────────────────────────────

export function buildGeminiImageBody(request: ImageGenerationRequest): Record<string, unknown> {
  const text = request.prompt.trim();
  if (!text) {
    throw new AIError({
      kind: 'bad-request',
      message: '图片描述不能为空',
      providerId: 'gemini-image',
    });
  }
  const parts: Array<Record<string, unknown>> = [
    { text: Array.from(text).slice(0, PROMPT_MAX).join('') },
  ];
  for (const reference of (request.referenceImages ?? []).slice(
    0,
    GEMINI_IMAGE_DEFAULTS.maxReferences
  )) {
    const inline = parseDataUrl(reference);
    if (inline) parts.push({ inline_data: { mime_type: inline.mimeType, data: inline.data } });
  }
  const generationConfig: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] };
  const ratio = request.aspectRatio?.trim();
  if (ratio && GEMINI_ASPECT_RATIOS.has(ratio))
    generationConfig.imageConfig = { aspectRatio: ratio };
  return { contents: [{ role: 'user', parts }], generationConfig };
}

export function parseGeminiImageResponse(json: GeminiGenerateResponse): GeneratedImage[] {
  const images = inlineParts(json)
    .filter((part) => !part.mimeType || part.mimeType.startsWith('image/'))
    .map((part) => ({ base64: part.data, mimeType: part.mimeType || 'image/png' }));
  if (images.length === 0) throw noOutputError(json, 'gemini-image', '图片');
  return images;
}

export function createGeminiImageProvider(config: ProviderConfig): ImageProvider {
  const id = 'gemini-image';
  const { client } = createGeminiClient(config, id, GEMINI_IMAGE_DEFAULTS);
  const defaultModel = config.model?.trim() || GEMINI_IMAGE_DEFAULTS.model;
  return {
    id,
    kind: 'image',
    supportsReferences: true,
    async generate(request, call: CallOptions = {}) {
      const model = request.model?.trim() || defaultModel;
      const body = buildGeminiImageBody(request);
      const count = clampImageCount(request.count);
      const images: GeneratedImage[] = [];
      // 每次请求只出一张图：依次请求，第一张失败直接报错，后面的失败时返回已有的
      for (let index = 0; index < count; index += 1) {
        try {
          const json = await client.json<GeminiGenerateResponse>(
            'POST',
            geminiModelPath(model, 'generateContent'),
            body,
            { signal: call.signal, retry: NO_RETRY }
          );
          images.push(...parseGeminiImageResponse(json).slice(0, 1));
        } catch (error) {
          if (images.length === 0 || call.signal?.aborted) throw error;
          break;
        }
      }
      return { images, model };
    },
    async testConnection(call: CallOptions = {}) {
      await client.json<unknown>('GET', geminiModelPath(defaultModel), undefined, {
        signal: call.signal,
      });
    },
  };
}

// ─── 语音 ───────────────────────────────────────────────────────────────

/** 情绪 → 英文朗读指令前缀（没有情绪时为空） */
export function geminiSpeechDirection(emotion: string | undefined): string {
  const value = emotionValue(emotion);
  if (!value) return '';
  return value === 'calm' ? 'Say calmly: ' : `Say in a ${value} tone: `;
}

function pickVoice(request: SpeechRequest, configured?: string): string {
  const voice = request.voice;
  if (voice?.providerVoiceId?.trim()) return voice.providerVoiceId.trim();
  if (voice?.gender === 'female') return GEMINI_SPEECH_DEFAULTS.voices.female;
  if (voice?.gender === 'male') return GEMINI_SPEECH_DEFAULTS.voices.male;
  return configured?.trim() || GEMINI_SPEECH_DEFAULTS.voices.neutral;
}

export function buildGeminiSpeechBody(
  request: SpeechRequest,
  configuredVoice?: string
): Record<string, unknown> {
  const raw = typeof request.text === 'string' ? request.text.trim() : '';
  if (!raw) {
    throw new AIError({
      kind: 'bad-request',
      message: '台词不能为空',
      providerId: 'gemini-speech',
    });
  }
  const text = `${geminiSpeechDirection(request.emotion)}${Array.from(raw).slice(0, SPEECH_TEXT_MAX).join('')}`;
  const speechConfig: Record<string, unknown> = {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: pickVoice(request, configuredVoice) } },
  };
  if (request.language?.trim()) speechConfig.languageCode = request.language.trim();
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig },
  };
}

/** PCM s16le 单声道 → WAV（补 44 字节头） */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      out[offset + index] = text.charCodeAt(index);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

/** 从 mimeType（audio/L16;codec=pcm;rate=24000）读取采样率 */
export function pcmSampleRate(mimeType: string | undefined): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? '');
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : GEMINI_SPEECH_DEFAULTS.sampleRate;
}

export function parseGeminiSpeechResponse(json: GeminiGenerateResponse): SpeechResult {
  const id = 'gemini-speech';
  const part = inlineParts(json)[0];
  if (!part) throw noOutputError(json, id, '音频');
  const bytes = base64ToBytes(part.data);
  if (!bytes || bytes.byteLength === 0) {
    throw new AIError({ kind: 'invalid-response', message: '没有返回音频', providerId: id });
  }
  const isWav = bytes.byteLength >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF';
  const wav = isWav ? bytes : pcmToWav(bytes, pcmSampleRate(part.mimeType));
  return toSpeechResult(wav, 'wav', id);
}

export function createGeminiSpeechProvider(config: ProviderConfig): SpeechProvider {
  const id = 'gemini-speech';
  const { client } = createGeminiClient(config, id, GEMINI_SPEECH_DEFAULTS);
  const defaultModel = config.model?.trim() || GEMINI_SPEECH_DEFAULTS.model;
  return {
    id,
    kind: 'speech',
    async synthesize(request, call: CallOptions = {}) {
      const model = request.model?.trim() || defaultModel;
      const json = await client.json<GeminiGenerateResponse>(
        'POST',
        geminiModelPath(model, 'generateContent'),
        buildGeminiSpeechBody(request, config.voice),
        { signal: call.signal, retry: NO_RETRY }
      );
      return parseGeminiSpeechResponse(json);
    },
    async testConnection(call: CallOptions = {}) {
      await client.json<unknown>('GET', geminiModelPath(defaultModel), undefined, {
        signal: call.signal,
      });
    },
  };
}
