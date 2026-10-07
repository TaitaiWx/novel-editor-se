/**
 * 文字转语音 Provider（场景视频的对白配音）：OpenAI 兼容 /audio/speech、MiniMax T2A v2
 *
 * 接口依据公开文档整理（2026-10），**均未用真实 Key 联调**，地址与字段集中在常量 / build*Body 里便于修正：
 *
 * - OpenAI 兼容：POST {base}/audio/speech
 *     { model, voice, input, response_format: 'mp3' | 'wav', instructions? } → 音频字节（Content-Type: audio/*）
 *     错误体 { error: { message } }（与 /chat/completions 相同，由 errors.ts 规范化）
 *   假设：
 *   - 语言由模型从输入文字自动识别；gpt-4o 系列支持 instructions（朗读指令），这里写入语言 / 情绪 / 音色描述，
 *     tts-1 / tts-1-hd 不支持 instructions，不发送
 *   - 没有指定音色时按性别取默认：女 nova、男 onyx、其他 alloy
 *   - testConnection 用 GET {base}/models 验证 Key 与地址（不产生费用）
 *
 * - MiniMax T2A v2：POST {base}/v1/t2a_v2
 *     { model, text, stream: false, language_boost, output_format: 'hex',
 *       voice_setting: { voice_id, speed, vol, pitch, emotion? },
 *       audio_setting: { sample_rate, bitrate, format, channel } }
 *     → { data: { audio: <hex> }, extra_info: { audio_length（毫秒）, audio_format }, base_resp }
 *     业务错误同视频接口：HTTP 200 + base_resp.status_code ≠ 0
 *   假设：
 *   - 不再发送旧版文档里的 GroupId 查询参数（新版文档只要求 Bearer Key；如需要可在 MINIMAX_SPEECH_ENDPOINTS 改）
 *   - 默认音色 id：男 male-qn-qingse、女 female-shaonv、其他 presenter_male（系统音色，文档示例中出现过）
 *   - emotion 只发送文档列出的枚举（happy / sad / angry / fearful / disgusted / surprised / calm），其他情绪不发送
 *   - language_boost 由 BCP-47 语言映射到文档的语种名（Chinese / Chinese,Yue / English / Japanese …），
 *     映射不到时用 auto
 *   - testConnection 合成一个很短的词（会产生极少量费用）
 */
import {
  detectAudioFormat,
  emotionValue,
  languageLabel,
  wavDurationSec,
  AUDIO_MIME_TYPES,
} from '@novel-editor/video';
import { AIError } from '../errors';
import { createHttpClient, NO_RETRY } from '../http';
import type {
  CallOptions,
  ProviderConfig,
  SpeechFormat,
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
  SpeechVoice,
} from '../types';
import { minimaxBaseRespError } from './minimax-video';

/** 单句台词上限（字符） */
export const SPEECH_TEXT_MAX = 1000;

export const OPENAI_SPEECH_DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini-tts',
  models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
  timeoutMs: 120_000,
  voices: { female: 'nova', male: 'onyx', neutral: 'alloy' },
} as const;

export const MINIMAX_SPEECH_DEFAULTS = {
  baseUrl: 'https://api.minimax.cn',
  model: 'speech-02-hd',
  models: ['speech-02-hd', 'speech-02-turbo'],
  timeoutMs: 120_000,
  voices: { female: 'female-shaonv', male: 'male-qn-qingse', neutral: 'presenter_male' },
  sampleRate: 32000,
  bitrate: 128000,
} as const;

export const MINIMAX_SPEECH_ENDPOINTS = { t2a: '/v1/t2a_v2' } as const;

/** BCP-47 主语言 → MiniMax language_boost */
const MINIMAX_LANGUAGE_BOOST: Record<string, string> = {
  'zh-HK': 'Chinese,Yue',
  zh: 'Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  pt: 'Portuguese',
  it: 'Italian',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
};

export function minimaxLanguageBoost(language: string): string {
  return (
    MINIMAX_LANGUAGE_BOOST[language] ??
    MINIMAX_LANGUAGE_BOOST[language.split('-')[0]?.toLowerCase() ?? ''] ??
    'auto'
  );
}

function trimText(text: string, providerId: string): string {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) throw new AIError({ kind: 'bad-request', message: '台词不能为空', providerId });
  return Array.from(value).slice(0, SPEECH_TEXT_MAX).join('');
}

function requireKey(config: ProviderConfig, providerId: string, label: string): string {
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({ kind: 'not-configured', message: `未配置${label} API Key`, providerId });
  }
  return apiKey;
}

function defaultVoice(
  voice: SpeechVoice | undefined,
  table: { female: string; male: string; neutral: string }
): string {
  if (voice?.providerVoiceId?.trim()) return voice.providerVoiceId.trim();
  if (voice?.gender === 'female') return table.female;
  if (voice?.gender === 'male') return table.male;
  return table.neutral;
}

/** 校验厂商返回的字节确实是音频，并推算时长（WAV 可从文件头计算） */
export function toSpeechResult(
  data: Uint8Array,
  requested: SpeechFormat,
  providerId: string,
  durationSec?: number
): SpeechResult {
  const detected = detectAudioFormat(data);
  if (detected !== 'mp3' && detected !== 'wav') {
    throw new AIError({
      kind: 'invalid-response',
      message: `配音服务没有返回可识别的 ${requested.toUpperCase()} 音频`,
      providerId,
    });
  }
  const duration = detected === 'wav' ? (wavDurationSec(data) ?? durationSec) : durationSec;
  return {
    data,
    format: detected,
    mimeType: AUDIO_MIME_TYPES[detected],
    ...(duration !== undefined && duration > 0 ? { durationSec: duration } : {}),
  };
}

// ─── OpenAI 兼容 ───────────────────────────────────────────────────────

/** 朗读指令（gpt-4o 系列）：语言 + 情绪 + 音色描述 */
export function speechInstructions(request: SpeechRequest): string {
  const parts = [`Speak in ${languageLabel(request.language)} (${request.language}).`];
  const emotion = emotionValue(request.emotion) ?? request.emotion?.trim();
  if (emotion) parts.push(`Emotion: ${emotion}.`);
  const traits = [request.voice?.age, request.voice?.timbre].filter(Boolean).join(', ');
  if (traits) parts.push(`Voice: ${traits}.`);
  return parts.join(' ');
}

export function buildOpenAISpeechBody(
  request: SpeechRequest,
  defaultModel: string
): Record<string, unknown> {
  const model = request.model?.trim() || defaultModel;
  const body: Record<string, unknown> = {
    model,
    voice: defaultVoice(request.voice, OPENAI_SPEECH_DEFAULTS.voices),
    input: trimText(request.text, 'openai-speech'),
    response_format: request.format ?? 'mp3',
  };
  if (/^gpt-4o/i.test(model)) body.instructions = speechInstructions(request);
  return body;
}

export function createOpenAISpeechProvider(config: ProviderConfig): SpeechProvider {
  const id = 'openai-speech';
  const apiKey = requireKey(config, id, 'OpenAI 配音');
  const model = config.model?.trim() || OPENAI_SPEECH_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || OPENAI_SPEECH_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? OPENAI_SPEECH_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  return {
    id,
    kind: 'speech',
    async synthesize(request, call: CallOptions = {}) {
      const body = buildOpenAISpeechBody(request, model);
      const response = await client.stream('/audio/speech', body, {
        signal: call.signal,
        retry: NO_RETRY,
      });
      let data: Uint8Array;
      try {
        data = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
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
      return toSpeechResult(data, request.format ?? 'mp3', id);
    },
    async testConnection(call: CallOptions = {}) {
      await client.json<unknown>('GET', '/models', undefined, { signal: call.signal });
    },
  };
}

// ─── MiniMax T2A v2 ────────────────────────────────────────────────────

interface MinimaxSpeechResponse {
  data?: { audio?: string; status?: number };
  extra_info?: { audio_length?: number; audio_format?: string };
  base_resp?: { status_code?: number; status_msg?: string };
}

export function buildMinimaxSpeechBody(
  request: SpeechRequest,
  defaultModel: string
): Record<string, unknown> {
  const voiceSetting: Record<string, unknown> = {
    voice_id: defaultVoice(request.voice, MINIMAX_SPEECH_DEFAULTS.voices),
    speed: 1,
    vol: 1,
    pitch: 0,
  };
  const emotion = emotionValue(request.emotion);
  if (emotion) voiceSetting.emotion = emotion;
  return {
    model: request.model?.trim() || defaultModel,
    text: trimText(request.text, 'minimax-speech'),
    stream: false,
    language_boost: minimaxLanguageBoost(request.language),
    output_format: 'hex',
    voice_setting: voiceSetting,
    audio_setting: {
      sample_rate: MINIMAX_SPEECH_DEFAULTS.sampleRate,
      bitrate: MINIMAX_SPEECH_DEFAULTS.bitrate,
      format: request.format ?? 'mp3',
      channel: 1,
    },
  };
}

/** 十六进制字符串 → 字节；格式不对时返回 null */
export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function createMinimaxSpeechProvider(config: ProviderConfig): SpeechProvider {
  const id = 'minimax-speech';
  const apiKey = requireKey(config, id, 'MiniMax');
  const model = config.model?.trim() || MINIMAX_SPEECH_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || MINIMAX_SPEECH_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? MINIMAX_SPEECH_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  const run = async (request: SpeechRequest, call: CallOptions): Promise<SpeechResult> => {
    const body = buildMinimaxSpeechBody(request, model);
    const json = await client.json<MinimaxSpeechResponse>(
      'POST',
      MINIMAX_SPEECH_ENDPOINTS.t2a,
      body,
      { signal: call.signal, retry: NO_RETRY }
    );
    const error = minimaxBaseRespError(json.base_resp);
    if (error) throw new AIError({ ...error.toJSON(), providerId: id });
    const data = hexToBytes(json.data?.audio ?? '');
    if (!data) {
      throw new AIError({ kind: 'invalid-response', message: '没有返回音频', providerId: id });
    }
    const lengthMs = json.extra_info?.audio_length;
    return toSpeechResult(
      data,
      request.format ?? 'mp3',
      id,
      typeof lengthMs === 'number' && lengthMs > 0 ? lengthMs / 1000 : undefined
    );
  };
  return {
    id,
    kind: 'speech',
    synthesize: (request, call: CallOptions = {}) => run(request, call),
    async testConnection(call: CallOptions = {}) {
      await run({ text: 'ok', language: 'en-US' }, call);
    },
  };
}
