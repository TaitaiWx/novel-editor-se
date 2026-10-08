import { describe, expect, it } from 'vitest';
import {
  AIError,
  buildMinimaxSpeechBody,
  buildOpenAISpeechBody,
  buildStoryboardPrompt,
  createDefaultRegistry,
  createMinimaxSpeechProvider,
  createOpenAISpeechProvider,
  hexToBytes,
  minimaxLanguageBoost,
  parseStoryboardResponse,
} from '../src';
import { jsonResponse, mockFetch } from './helpers';

/** 最小的 16-bit 单声道 WAV（静音） */
function wav(durationSec: number, sampleRate = 8000): Uint8Array {
  const data = Math.round(durationSec * sampleRate) * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  return bytes;
}

const MP3_HEADER = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('配音 Provider：请求映射', () => {
  it('OpenAI 兼容：按性别取默认音色，gpt-4o 系列带朗读指令（语言 / 情绪 / 音色）', () => {
    expect(
      buildOpenAISpeechBody(
        {
          text: ' 走吧 ',
          language: 'zh-CN',
          emotion: '悲伤',
          voice: { gender: 'female', age: '少女', timbre: '清亮' },
          format: 'wav',
        },
        'gpt-4o-mini-tts'
      )
    ).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'nova',
      input: '走吧',
      response_format: 'wav',
      instructions: 'Speak in 普通话 (zh-CN). Emotion: sad. Voice: 少女, 清亮.',
    });
    // tts-1 不支持 instructions；指定了音色 id 时优先使用
    expect(
      buildOpenAISpeechBody(
        { text: 'hi', language: 'en-US', voice: { providerVoiceId: 'echo', gender: 'male' } },
        'tts-1'
      )
    ).toEqual({ model: 'tts-1', voice: 'echo', input: 'hi', response_format: 'mp3' });
    expect(() => buildOpenAISpeechBody({ text: '  ', language: 'zh-CN' }, 'tts-1')).toThrow(
      AIError
    );
  });

  it('MiniMax T2A：语种增强、情绪枚举、音色、hex 输出', () => {
    expect(
      buildMinimaxSpeechBody(
        { text: '你好', language: 'zh-HK', emotion: 'angry', voice: { gender: 'male' } },
        'speech-02-hd'
      )
    ).toEqual({
      model: 'speech-02-hd',
      text: '你好',
      stream: false,
      language_boost: 'Chinese,Yue',
      output_format: 'hex',
      voice_setting: { voice_id: 'male-qn-qingse', speed: 1, vol: 1, pitch: 0, emotion: 'angry' },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    });
    // 不在枚举里的情绪不发送
    const body = buildMinimaxSpeechBody({ text: 'x', language: 'ja-JP', emotion: '哽咽' }, 'm');
    expect((body.voice_setting as Record<string, unknown>).emotion).toBeUndefined();
    expect(minimaxLanguageBoost('en-GB')).toBe('English');
    expect(minimaxLanguageBoost('xx-YY')).toBe('auto');
    expect(hexToBytes('0aff')).toEqual(new Uint8Array([10, 255]));
    expect(hexToBytes('abc')).toBeNull();
    expect(hexToBytes('zz')).toBeNull();
  });

  it('注册表：配音服务按 kind 列出，可创建', () => {
    const registry = createDefaultRegistry();
    expect(registry.list('speech').map((item) => item.id)).toEqual([
      'openai-speech',
      'minimax-speech',
      'volcengine-speech',
      'grok-speech',
      'gemini-speech',
    ]);
    expect(registry.createSpeech('grok-speech', { apiKey: 'k' }).id).toBe('grok-speech');
    expect(registry.createSpeech('gemini-speech', { apiKey: 'k' }).id).toBe('gemini-speech');
    expect(registry.get('openai-speech')?.envKey).toBe('NOVEL_EDITOR_OPENAI_SPEECH_API_KEY');
    expect(registry.createSpeech('openai-speech', { apiKey: 'k' }).kind).toBe('speech');
    expect(() => registry.createSpeech('grok', { apiKey: 'k' })).toThrow('不是配音服务');
    expect(() => createOpenAISpeechProvider({ apiKey: '' })).toThrow('未配置');
  });
});

describe('配音 Provider：mock fetch', () => {
  it('OpenAI 兼容：POST /audio/speech，返回音频字节与 WAV 时长', async () => {
    const audio = wav(0.5);
    const { fetch, requests } = mockFetch(
      new Response(audio, { status: 200, headers: { 'Content-Type': 'audio/wav' } })
    );
    const provider = createOpenAISpeechProvider({
      apiKey: 'sk-speech',
      baseUrl: 'https://tts.example/v1/',
      fetch,
    });
    const result = await provider.synthesize({ text: '出发', language: 'zh-CN', format: 'wav' });
    expect(requests[0]).toMatchObject({
      url: 'https://tts.example/v1/audio/speech',
      method: 'POST',
      headers: { Authorization: 'Bearer sk-speech' },
      body: { model: 'gpt-4o-mini-tts', voice: 'alloy', input: '出发', response_format: 'wav' },
    });
    expect(result.format).toBe('wav');
    expect(result.mimeType).toBe('audio/wav');
    expect(result.durationSec).toBe(0.5);
    expect(result.data).toEqual(audio);
  });

  it('OpenAI 兼容：返回的不是音频 / HTTP 错误都规范化为 AIError', async () => {
    const notAudio = mockFetch(new Response('<html>oops</html>', { status: 200 }));
    await expect(
      createOpenAISpeechProvider({ apiKey: 'k', fetch: notAudio.fetch }).synthesize({
        text: 'x',
        language: 'en-US',
      })
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    const denied = mockFetch(jsonResponse({ error: { message: 'Incorrect API key' } }, 401));
    await expect(
      createOpenAISpeechProvider({ apiKey: 'k', fetch: denied.fetch }).synthesize({
        text: 'x',
        language: 'en-US',
      })
    ).rejects.toMatchObject({ kind: 'auth' });
    // 提交配音不重试（避免重复扣费）
    expect(denied.requests).toHaveLength(1);
  });

  it('MiniMax：hex 音频解码、时长取 extra_info，业务错误码映射', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({
        data: { audio: toHex(MP3_HEADER), status: 2 },
        extra_info: { audio_length: 1800, audio_format: 'mp3' },
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
      jsonResponse({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } })
    );
    const provider = createMinimaxSpeechProvider({ apiKey: 'mm', fetch });
    const result = await provider.synthesize({ text: '你好', language: 'zh-CN' });
    expect(requests[0].url).toBe('https://api.minimax.cn/v1/t2a_v2');
    expect(result).toMatchObject({ format: 'mp3', mimeType: 'audio/mpeg', durationSec: 1.8 });
    expect(result.data).toEqual(MP3_HEADER);
    await expect(provider.synthesize({ text: '你好', language: 'zh-CN' })).rejects.toMatchObject({
      kind: 'auth',
      providerId: 'minimax-speech',
    });
  });
});

describe('分镜提示词：对白与音效', () => {
  it('提示词要求提取对白（说话人 / 台词 / 情绪）与音效，并写明对白语言', () => {
    const prompt = buildStoryboardPrompt({ sceneText: '“走吧。”林舟说。', language: 'en_us' });
    expect(prompt.systemPrompt).toContain('dialogue');
    expect(prompt.systemPrompt).toContain('narrator');
    expect(prompt.systemPrompt).toContain('sfx');
    expect(prompt.prompt).toContain('对白语言：英语（美国）（en-US）');
    expect(JSON.stringify(prompt.schema)).toContain('"speaker"');
    expect(buildStoryboardPrompt({ sceneText: 'x' }).prompt).not.toContain('对白语言');
  });

  it('解析带对白的分镜：容忍别名，旧版字符串台词也能读', () => {
    const parsed = parseStoryboardResponse(
      JSON.stringify({
        shots: [
          {
            shotSize: '近景',
            durationSec: 4,
            description: '林舟回头',
            dialogue: [
              { speaker: '林舟', text: '走吧', emotion: 'calm' },
              { character: '旁白', line: '那天风很大' },
            ],
            sfx: [{ prompt: '风声', atSec: 1 }],
          },
          { shotSize: '远景', durationSec: 3, description: '镇口', dialogue: '小石头：舟哥！' },
        ],
      })
    );
    if (!parsed.ok) throw new Error(parsed.errors.join(';'));
    expect(parsed.storyboard.shots[0].dialogue).toEqual([
      { id: 'l1', speaker: '林舟', text: '走吧', emotion: 'calm' },
      { id: 'l2', speaker: 'narrator', text: '那天风很大' },
    ]);
    expect(parsed.storyboard.shots[0].sfx).toEqual([
      { id: 's1', prompt: '风声', atSec: 1, volume: 0.8 },
    ]);
    expect(parsed.storyboard.shots[1].dialogue).toEqual([
      { id: 'l1', speaker: '小石头', text: '舟哥！' },
    ]);
  });
});
