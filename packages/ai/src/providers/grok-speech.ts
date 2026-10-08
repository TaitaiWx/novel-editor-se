/**
 * xAI Grok 文字转语音 Provider（场景视频的对白配音）
 *
 * 文档（2026-10-09 核对）：https://docs.x.ai/developers/model-capabilities/audio/text-to-speech.md
 *
 * - POST {base}/tts
 *     { text, language, voice_id, output_format: { codec: 'mp3' | 'wav', sample_rate: 24000 } }
 *     → 音频字节（Content-Type: audio/mpeg / audio/wav）
 *   请求体**没有 model 字段**（描述里的 grok-tts 只用于显示）；language 必填（BCP-47 或 auto）
 * - 音色列表：GET {base}/tts/voices → { voices: [{ voice_id, name }] }（testConnection 使用，不产生费用）
 * - 所有内置音色都能说全部支持的语言；voice_id 不区分大小写
 *
 * 假设：
 * - 响应一般是音频字节；如果是 JSON（例如带时间戳的封装），读取 { audio（base64）, content_type, duration }
 * - 情绪：文档只有内联 / 包裹的「语音标签」（如 <whisper>），没有和我们的情绪选项（开心 / 悲伤 …）明确对应的标签，
 *   因此不处理 emotion
 * - 没有指定音色时：女 eve、男 rex、其他 ara（设置中心填写的默认声音优先于中性默认）
 */
import { AIError } from '../errors';
import { createHttpClient, NO_RETRY } from '../http';
import type {
  CallOptions,
  ProviderConfig,
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
} from '../types';
import { base64ToBytes, SPEECH_TEXT_MAX, toSpeechResult } from './speech';

export const GROK_SPEECH_DEFAULTS = {
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-tts',
  models: ['grok-tts'],
  timeoutMs: 120_000,
  sampleRate: 24000,
  voices: { female: 'eve', male: 'rex', neutral: 'ara' },
} as const;

/** 内置音色（全部支持多语种） */
export const GROK_SPEECH_VOICES = {
  female: ['ara', 'aurora', 'carina', 'celeste', 'eve', 'iris', 'liora', 'luna', 'ursa'],
  male: [
    'altair',
    'atlas',
    'castor',
    'cosmo',
    'helios',
    'helix',
    'kepler',
    'leo',
    'lumen',
    'lux',
    'naksh',
    'orion',
    'perseus',
    'rex',
    'rigel',
    'sal',
    'sirius',
    'zagan',
    'zenith',
  ],
} as const;

export const GROK_SPEECH_ENDPOINTS = { tts: '/tts', voices: '/tts/voices' } as const;

/** 只有主语言的 xAI 语言代码 */
const PRIMARY_LANGUAGES = new Set([
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'ru',
  'it',
  'hi',
  'id',
  'tr',
  'vi',
  'bn',
]);
/** 需要地区的 xAI 语言代码（主语言 → 默认地区） */
const REGIONAL_LANGUAGES: Record<string, { regions: readonly string[]; fallback: string }> = {
  es: { regions: ['ES', 'MX'], fallback: 'es-ES' },
  pt: { regions: ['BR', 'PT'], fallback: 'pt-BR' },
  ar: { regions: ['EG', 'SA', 'AE'], fallback: 'ar-SA' },
};

/** BCP-47 → xAI 支持的语言代码；不支持时 auto */
export function grokSpeechLanguage(language: string | undefined): string {
  const [primaryRaw, ...rest] = (language ?? '').trim().split(/[-_]/);
  const primary = (primaryRaw ?? '').toLowerCase();
  if (PRIMARY_LANGUAGES.has(primary)) return primary;
  const regional = REGIONAL_LANGUAGES[primary];
  if (regional) {
    const region = rest.find((part) => part.length === 2)?.toUpperCase();
    return region && regional.regions.includes(region) ? `${primary}-${region}` : regional.fallback;
  }
  return 'auto';
}

function trimText(text: string): string {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    throw new AIError({ kind: 'bad-request', message: '台词不能为空', providerId: 'grok-speech' });
  }
  return Array.from(value).slice(0, SPEECH_TEXT_MAX).join('');
}

function pickVoice(request: SpeechRequest, configured?: string): string {
  const voice = request.voice;
  if (voice?.providerVoiceId?.trim()) return voice.providerVoiceId.trim();
  if (voice?.gender === 'female') return GROK_SPEECH_DEFAULTS.voices.female;
  if (voice?.gender === 'male') return GROK_SPEECH_DEFAULTS.voices.male;
  return configured?.trim() || GROK_SPEECH_DEFAULTS.voices.neutral;
}

export function buildGrokSpeechBody(
  request: SpeechRequest,
  configuredVoice?: string
): Record<string, unknown> {
  return {
    text: trimText(request.text),
    language: grokSpeechLanguage(request.language),
    voice_id: pickVoice(request, configuredVoice),
    output_format: { codec: request.format ?? 'mp3', sample_rate: GROK_SPEECH_DEFAULTS.sampleRate },
  };
}

interface GrokSpeechJson {
  audio?: string;
  content_type?: string;
  duration?: number;
}

/** 解析响应：音频字节或 JSON 封装（导出供测试） */
export async function readGrokSpeechResponse(
  response: Response,
  requested: SpeechRequest['format']
): Promise<SpeechResult> {
  const id = 'grok-speech';
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!contentType.includes('json')) return toSpeechResult(bytes, requested ?? 'mp3', id);
  let json: GrokSpeechJson;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes)) as GrokSpeechJson;
  } catch {
    throw new AIError({
      kind: 'invalid-response',
      message: '配音服务返回了无效的 JSON',
      providerId: id,
    });
  }
  const data = base64ToBytes(json.audio ?? '');
  if (!data)
    throw new AIError({ kind: 'invalid-response', message: '没有返回音频', providerId: id });
  const duration =
    typeof json.duration === 'number' && json.duration > 0 ? json.duration : undefined;
  return toSpeechResult(data, requested ?? 'mp3', id, duration);
}

export function createGrokSpeechProvider(config: ProviderConfig): SpeechProvider {
  const id = 'grok-speech';
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({ kind: 'not-configured', message: '未配置 xAI API Key', providerId: id });
  }
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || GROK_SPEECH_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? GROK_SPEECH_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  return {
    id,
    kind: 'speech',
    async synthesize(request, call: CallOptions = {}) {
      const response = await client.stream(
        GROK_SPEECH_ENDPOINTS.tts,
        buildGrokSpeechBody(request, config.voice),
        {
          signal: call.signal,
          retry: NO_RETRY,
          headers: { Accept: 'audio/mpeg, audio/wav, application/json' },
        }
      );
      try {
        return await readGrokSpeechResponse(response, request.format);
      } catch (error) {
        if (error instanceof AIError) throw error;
        if (call.signal?.aborted) {
          throw new AIError({ kind: 'aborted', message: '请求已取消', providerId: id });
        }
        throw new AIError({
          kind: 'network',
          message: '读取配音结果失败',
          providerId: id,
          cause: error,
        });
      }
    },
    async testConnection(call: CallOptions = {}) {
      await client.json<unknown>('GET', GROK_SPEECH_ENDPOINTS.voices, undefined, {
        signal: call.signal,
      });
    },
  };
}
