import { describe, expect, it } from 'vitest';
import {
  AIError,
  buildVolcengineSpeechBody,
  createDefaultRegistry,
  createVolcengineSpeechProvider,
  parseVolcengineChunks,
  resourceIdFor,
  volcengineSpeaker,
  VOLCENGINE_TTS_DONE,
} from '../src';
import { jsonResponse, mockFetch } from './helpers';

const MP3_HEADER = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const MP3_FRAME = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00]);

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** 文档的 Chunked 响应：每行一个 JSON，最后是结束码 */
function chunkedBody(parts: Uint8Array[], end: Record<string, unknown> = {}): string {
  const lines = parts.map((part) => JSON.stringify({ code: 0, message: '', data: base64(part) }));
  lines.splice(1, 0, JSON.stringify({ code: 0, message: '', data: null, sentence: { text: 'x' } }));
  lines.push(JSON.stringify({ code: VOLCENGINE_TTS_DONE, message: 'ok', data: null, ...end }));
  return `${lines.join('\n')}\n`;
}

describe('豆包语音（火山引擎）配音：请求映射', () => {
  it('资源 id 按音色版本自动选择，看不出版本时用配置的模型', () => {
    expect(resourceIdFor('zh_female_vv_uranus_bigtts', 'seed-tts-1.0')).toBe('seed-tts-2.0');
    expect(resourceIdFor('saturn_zh_female_x', 'seed-tts-1.0')).toBe('seed-tts-2.0');
    expect(resourceIdFor('zh_female_shuangkuaisisi_moon_bigtts', 'seed-tts-2.0')).toBe(
      'seed-tts-1.0'
    );
    expect(resourceIdFor('zh_male_beijingxiaoye_emo_v2_mars_bigtts', 'seed-tts-1.0-concurr')).toBe(
      'seed-tts-1.0-concurr'
    );
    expect(resourceIdFor('S_EVeoGUVU1', 'seed-tts-2.0')).toBe('seed-icl-2.0');
    expect(resourceIdFor('S_EVeoGUVU1', 'seed-icl-1.0')).toBe('seed-icl-1.0');
    expect(resourceIdFor('custom_voice', 'seed-tts-1.0')).toBe('seed-tts-1.0');
  });

  it('音色：台词指定的 > 按性别（中文 / 英文）> 设置的默认声音 > 中性默认', () => {
    expect(volcengineSpeaker({ providerVoiceId: ' my_voice ' }, 'zh-CN')).toBe('my_voice');
    expect(volcengineSpeaker({ gender: 'female' }, 'zh-CN')).toBe('zh_female_vv_uranus_bigtts');
    expect(volcengineSpeaker({ gender: 'male' }, 'zh-CN')).toBe('zh_male_m191_uranus_bigtts');
    expect(volcengineSpeaker({ gender: 'male' }, 'en-US')).toBe('en_male_david_uranus_bigtts');
    expect(volcengineSpeaker(undefined, 'zh-CN', 'zh_male_liufei_uranus_bigtts')).toBe(
      'zh_male_liufei_uranus_bigtts'
    );
    expect(volcengineSpeaker(undefined, 'zh-CN')).toBe('zh_female_xiaohe_uranus_bigtts');
  });

  it('请求体：mp3 / 24k；只有多情感音色才发送情感（映射到文档参数）；空台词报错', () => {
    expect(
      buildVolcengineSpeechBody({ text: ' 走吧 ', language: 'zh-CN', emotion: '害怕' }).body
    ).toEqual({
      user: { uid: 'novel-editor' },
      req_params: {
        text: '走吧',
        speaker: 'zh_female_xiaohe_uranus_bigtts',
        audio_params: { format: 'mp3', sample_rate: 24000 },
      },
    });
    const emo = buildVolcengineSpeechBody({
      text: '你走',
      language: 'zh-CN',
      emotion: 'fearful',
      voice: { providerVoiceId: 'zh_male_beijingxiaoye_emo_v2_mars_bigtts' },
    });
    expect((emo.body.req_params as { audio_params: unknown }).audio_params).toEqual({
      format: 'mp3',
      sample_rate: 24000,
      emotion: 'fear',
    });
    expect(() => buildVolcengineSpeechBody({ text: '  ', language: 'zh-CN' })).toThrow(
      '台词不能为空'
    );
  });
});

describe('豆包语音（火山引擎）配音：响应解析', () => {
  it('逐行拼接 base64 音频，跳过句子信息，遇到结束码停止；兼容 SSE 的 data: 前缀', () => {
    const merged = parseVolcengineChunks(chunkedBody([MP3_HEADER, MP3_FRAME]));
    expect(Array.from(merged)).toEqual([...MP3_HEADER, ...MP3_FRAME]);
    const sse = chunkedBody([MP3_HEADER])
      .split('\n')
      .filter(Boolean)
      .map((line) => `data: ${line}`)
      .join('\n\n');
    expect(Array.from(parseVolcengineChunks(sse))).toEqual([...MP3_HEADER]);
  });

  it('错误码映射：音色鉴权失败 / 文本超长 / 并发限流 / 服务端错误；没有音频时报错', () => {
    const fail = (line: Record<string, unknown>) => {
      try {
        parseVolcengineChunks(JSON.stringify(line));
      } catch (error) {
        return error as AIError;
      }
      throw new Error('应当失败');
    };
    expect(
      fail({ code: 45000000, message: 'speaker permission denied: get resource id: access denied' })
    ).toMatchObject({ kind: 'auth', providerId: 'volcengine-speech' });
    expect(fail({ code: 40402003, message: 'TTSExceededTextLimit' }).kind).toBe('bad-request');
    expect(fail({ code: 45000292, message: 'quota exceeded for types: concurrency' }).kind).toBe(
      'rate-limit'
    );
    expect(fail({ code: 55000000, message: 'resource ID is mismatched' })).toMatchObject({
      kind: 'server',
      message: 'resource ID is mismatched（55000000）',
    });
    expect(() => parseVolcengineChunks('')).toThrow('没有返回音频');
  });
});

describe('豆包语音（火山引擎）配音：Provider', () => {
  it('X-Api-Key 鉴权、按音色带 X-Api-Resource-Id 与请求 id，结果为 mp3；测试连接合成一个短词', async () => {
    const { fetch, requests } = mockFetch(
      new Response(chunkedBody([MP3_HEADER, MP3_FRAME]), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const provider = createVolcengineSpeechProvider({
      apiKey: 'volc-key',
      model: 'seed-tts-1.0',
      voice: 'zh_male_liufei_uranus_bigtts',
      fetch,
    });
    const result = await provider.synthesize({ text: '你好', language: 'zh-CN' });
    expect(requests[0].url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
    expect(requests[0].headers['X-Api-Key']).toBe('volc-key');
    // 配置的模型是 1.0，但默认声音是 2.0 音色：自动用 seed-tts-2.0，避免 resource ID mismatched
    expect(requests[0].headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
    expect(requests[0].headers['X-Api-Request-Id']).toBeTruthy();
    expect(requests[0].headers).not.toHaveProperty('Authorization');
    expect((requests[0].body as { req_params: { speaker: string } }).req_params.speaker).toBe(
      'zh_male_liufei_uranus_bigtts'
    );
    expect(result).toMatchObject({ format: 'mp3', mimeType: 'audio/mpeg' });
    expect(Array.from(result.data)).toEqual([...MP3_HEADER, ...MP3_FRAME]);

    await provider.testConnection();
    expect((requests[1].body as { req_params: { text: string } }).req_params.text).toBe('你好');
  });

  it('HTTP 401 规范化为 auth；没有 Key 时 not-configured；已在注册表中', async () => {
    const { fetch } = mockFetch(jsonResponse({ code: 45000010, message: 'invalid api key' }, 401));
    const provider = createVolcengineSpeechProvider({ apiKey: 'bad', fetch });
    await expect(provider.synthesize({ text: '你好', language: 'zh-CN' })).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(() => createVolcengineSpeechProvider({ apiKey: ' ' })).toThrow('未配置豆包语音 API Key');
    const descriptor = createDefaultRegistry().get('volcengine-speech');
    expect(descriptor).toMatchObject({
      kind: 'speech',
      defaultBaseUrl: 'https://openspeech.bytedance.com',
      defaultModel: 'seed-tts-2.0',
      envKey: 'NOVEL_EDITOR_VOLCENGINE_SPEECH_API_KEY',
    });
  });
});
