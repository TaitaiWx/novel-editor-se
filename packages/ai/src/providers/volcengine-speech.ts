/**
 * 火山引擎「豆包语音」语音合成（场景视频的对白配音）
 *
 * 接口依据公开文档整理（2026-10-09 核对，**未用真实 Key 联调**）：
 * - HTTP Chunked 单向流式 V3：https://www.volcengine.com/docs/6561/1598757
 * - 音色列表：https://www.volcengine.com/docs/6561/1257544
 *
 * - POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
 *   请求头（新版控制台）：X-Api-Key（控制台「API Key 管理」）、X-Api-Resource-Id（模型版本，也决定计费）、
 *   X-Api-Request-Id（可选，uuid）。旧版控制台的 X-Api-App-Id + X-Api-Access-Key 不支持（设置里只有一个 Key）
 *   请求体 { user: { uid }, req_params: { text, speaker, audio_params: { format, sample_rate, emotion?, emotion_scale? } } }
 *   响应：HTTP Chunked，每行一个 JSON：{ code: 0, data: <base64 音频片段> } / { code: 0, data: null, sentence }，
 *   结束行 { code: 20000000, message: 'ok' }；其他 code 是错误（45000000 音色鉴权失败、40402003 文本超长、
 *   55000000 服务端错误、并发超限等）
 * - X-Api-Resource-Id 必须与音色匹配，否则报「resource ID is mismatched」：
 *   `*_uranus_*` / `saturn_*` → seed-tts-2.0；`*_mars_*` / `*_moon_*` → seed-tts-1.0；`S_*` → seed-icl-2.0。
 *   这里按音色自动选择（resourceIdFor），模型字段（seed-tts-2.0 等）只在音色看不出版本时使用
 *
 * 假设：
 * - 只请求 mp3（文档说明流式下 wav 会多次返回 wav 头），结果按 mp3 保存
 * - 情绪：只有 1.0 多情感音色（音色 id 含 `_emo_`）发送 audio_params.emotion（映射到文档的情感参数），
 *   其他音色不支持该参数，不发送；语种不发送 explicit_language（文档：不指定时正常中英混读）
 * - 没有指定音色时按性别取 2.0 音色：女 Vivi 2.0、男 云舟 2.0、其他 小何 2.0；英文台词用英文音色
 * - testConnection 合成一个很短的词（会产生极少量费用）
 */
import { emotionValue } from '@novel-editor/video';
import { AIError, type AIErrorKind } from '../errors';
import { createHttpClient, NO_RETRY } from '../http';
import type {
  CallOptions,
  ProviderConfig,
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
  SpeechVoice,
} from '../types';
import { SPEECH_TEXT_MAX, toSpeechResult } from './speech';

export const VOLCENGINE_SPEECH_DEFAULTS = {
  baseUrl: 'https://openspeech.bytedance.com',
  model: 'seed-tts-2.0',
  models: ['seed-tts-2.0', 'seed-tts-1.0', 'seed-icl-2.0'],
  timeoutMs: 120_000,
  sampleRate: 24000,
  voices: {
    zh: {
      female: 'zh_female_vv_uranus_bigtts',
      male: 'zh_male_m191_uranus_bigtts',
      neutral: 'zh_female_xiaohe_uranus_bigtts',
    },
    en: {
      female: 'en_female_jenny_uranus_bigtts',
      male: 'en_male_david_uranus_bigtts',
      neutral: 'en_female_jenny_uranus_bigtts',
    },
  },
} as const;

export const VOLCENGINE_SPEECH_ENDPOINTS = { tts: '/api/v3/tts/unidirectional' } as const;

/** 设置中心「默认声音」的候选（2.0 通用音色，文档音色列表） */
export const VOLCENGINE_SPEECH_VOICES = [
  'zh_female_vv_uranus_bigtts',
  'zh_female_xiaohe_uranus_bigtts',
  'zh_male_m191_uranus_bigtts',
  'zh_male_taocheng_uranus_bigtts',
  'zh_male_liufei_uranus_bigtts',
  'zh_female_sophie_uranus_bigtts',
  'zh_female_qingxinnvsheng_uranus_bigtts',
  'zh_female_cancan_uranus_bigtts',
  'zh_female_shuangkuaisisi_uranus_bigtts',
  'en_female_jenny_uranus_bigtts',
  'en_male_david_uranus_bigtts',
] as const;

/** 结束行的成功状态码 */
export const VOLCENGINE_TTS_DONE = 20_000_000;

/** 我们的情绪选项 → 文档的情感参数（1.0 多情感音色） */
const EMOTION_MAP: Record<string, string> = {
  calm: 'neutral',
  happy: 'happy',
  sad: 'sad',
  angry: 'angry',
  fearful: 'fear',
  surprised: 'surprised',
  disgusted: 'hate',
};

/** 按音色选资源 id（模型版本）；看不出版本时用配置的模型 */
export function resourceIdFor(speaker: string, model: string): string {
  if (/^S_/.test(speaker)) return model.startsWith('seed-icl') ? model : 'seed-icl-2.0';
  if (/_uranus_/.test(speaker) || /^saturn_/.test(speaker)) return 'seed-tts-2.0';
  if (/_(mars|moon)_/.test(speaker))
    return model.startsWith('seed-tts-1.0') ? model : 'seed-tts-1.0';
  return model;
}

/** 声音：台词指定的 > 按性别（按语种选中文 / 英文音色）> 设置中心的默认声音 > 中性默认 */
export function volcengineSpeaker(
  voice: SpeechVoice | undefined,
  language: string,
  configured?: string
): string {
  if (voice?.providerVoiceId?.trim()) return voice.providerVoiceId.trim();
  const table = /^en\b/i.test(language)
    ? VOLCENGINE_SPEECH_DEFAULTS.voices.en
    : VOLCENGINE_SPEECH_DEFAULTS.voices.zh;
  if (voice?.gender === 'female') return table.female;
  if (voice?.gender === 'male') return table.male;
  return configured?.trim() || table.neutral;
}

export function buildVolcengineSpeechBody(
  request: SpeechRequest,
  configuredVoice?: string
): { speaker: string; body: Record<string, unknown> } {
  const text = typeof request.text === 'string' ? request.text.trim() : '';
  if (!text) {
    throw new AIError({
      kind: 'bad-request',
      message: '台词不能为空',
      providerId: 'volcengine-speech',
    });
  }
  const speaker = volcengineSpeaker(request.voice, request.language, configuredVoice);
  const audioParams: Record<string, unknown> = {
    format: 'mp3',
    sample_rate: VOLCENGINE_SPEECH_DEFAULTS.sampleRate,
  };
  const emotion = emotionValue(request.emotion);
  if (emotion && /_emo_/.test(speaker) && EMOTION_MAP[emotion]) {
    audioParams.emotion = EMOTION_MAP[emotion];
  }
  return {
    speaker,
    body: {
      user: { uid: 'novel-editor' },
      req_params: {
        text: Array.from(text).slice(0, SPEECH_TEXT_MAX).join(''),
        speaker,
        audio_params: audioParams,
      },
    },
  };
}

interface ChunkLine {
  code?: number;
  message?: string;
  data?: string | null;
}

/** 文档错误码 → AIError 类别 */
function chunkError(line: ChunkLine, providerId: string): AIError {
  const code = line.code ?? -1;
  const message = line.message?.trim() || `语音合成失败（${code}）`;
  let kind: AIErrorKind = 'unknown';
  if (code === 45_000_000) kind = 'auth';
  else if (code === 40_402_003) kind = 'bad-request';
  else if (/quota|concurren/i.test(message)) kind = 'rate-limit';
  else if (code === 55_000_000 || code >= 50_000_000) kind = 'server';
  else if (code >= 40_000_000) kind = 'bad-request';
  return new AIError({ kind, message: `${message}（${code}）`, providerId });
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** 解析 Chunked 响应：逐行 JSON，拼接 base64 音频，遇到结束码停止（也兼容 SSE 的 `data:` 前缀） */
export function parseVolcengineChunks(text: string, providerId = 'volcengine-speech'): Uint8Array {
  const parts: Uint8Array[] = [];
  let done = false;
  for (const raw of text.split(/\r?\n/)) {
    const lineText = raw.replace(/^data:\s*/, '').trim();
    if (!lineText || !lineText.startsWith('{')) continue;
    let line: ChunkLine;
    try {
      line = JSON.parse(lineText) as ChunkLine;
    } catch {
      continue;
    }
    if (line.code === VOLCENGINE_TTS_DONE) {
      done = true;
      break;
    }
    if (line.code !== 0 && line.code !== undefined) throw chunkError(line, providerId);
    if (typeof line.data === 'string' && line.data) {
      try {
        parts.push(base64ToBytes(line.data));
      } catch {
        throw new AIError({ kind: 'invalid-response', message: '音频数据无法解析', providerId });
      }
    }
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (!done && total === 0) {
    throw new AIError({ kind: 'invalid-response', message: '没有返回音频', providerId });
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function requestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `ne-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createVolcengineSpeechProvider(config: ProviderConfig): SpeechProvider {
  const id = 'volcengine-speech';
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({
      kind: 'not-configured',
      message: '未配置豆包语音 API Key',
      providerId: id,
    });
  }
  const model = config.model?.trim() || VOLCENGINE_SPEECH_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || VOLCENGINE_SPEECH_DEFAULTS.baseUrl,
    headers: { 'X-Api-Key': apiKey },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? VOLCENGINE_SPEECH_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });
  const run = async (request: SpeechRequest, call: CallOptions): Promise<SpeechResult> => {
    const { speaker, body } = buildVolcengineSpeechBody(request, config.voice);
    const response = await client.stream(VOLCENGINE_SPEECH_ENDPOINTS.tts, body, {
      signal: call.signal,
      retry: NO_RETRY,
      headers: {
        'X-Api-Resource-Id': resourceIdFor(speaker, request.model?.trim() || model),
        'X-Api-Request-Id': requestId(),
      },
    });
    let text: string;
    try {
      text = await response.text();
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
    return toSpeechResult(parseVolcengineChunks(text, id), 'mp3', id);
  };
  return {
    id,
    kind: 'speech',
    synthesize: (request, call: CallOptions = {}) => run(request, call),
    async testConnection(call: CallOptions = {}) {
      await run({ text: '你好', language: 'zh-CN' }, call);
    },
  };
}
