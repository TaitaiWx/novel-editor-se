import { describe, expect, it } from 'vitest';
import {
  buildGeminiImageBody,
  buildGeminiSpeechBody,
  buildGeminiVideoBody,
  createDefaultRegistry,
  createGeminiImageProvider,
  createGeminiSpeechProvider,
  createGeminiVideoProvider,
  extractGeminiVideo,
  geminiSpeechDirection,
  geminiVideoAspectRatio,
  geminiVideoDownloadUrl,
  geminiVideoResolution,
  mapGeminiVideoInteraction,
  parseDataUrl,
  parseGeminiImageResponse,
  parseGeminiSpeechResponse,
  pcmSampleRate,
  pcmToWav,
} from '../src';
import { wavDurationSec } from '@novel-editor/video';
import { jsonResponse, mockFetch } from './helpers';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function imageReply(data = 'IMG', mimeType = 'image/png') {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType, data } }] } }],
  });
}

describe('gemini-image', () => {
  it('请求体：文字 + data URL 参考图（跳过 http 地址）+ 比例', () => {
    expect(
      buildGeminiImageBody({
        prompt: ' 灯塔 ',
        aspectRatio: '3:4',
        referenceImages: ['data:image/jpeg;base64,AAA', 'https://cdn/a.png'],
      })
    ).toEqual({
      contents: [
        {
          role: 'user',
          parts: [{ text: '灯塔' }, { inline_data: { mime_type: 'image/jpeg', data: 'AAA' } }],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '3:4' },
      },
    });
    expect(buildGeminiImageBody({ prompt: 'x', aspectRatio: '7:3' }).generationConfig).toEqual({
      responseModalities: ['TEXT', 'IMAGE'],
    });
    expect(parseDataUrl('data:image/png;charset=x;base64,QQ==')).toEqual({
      mimeType: 'image/png',
      data: 'QQ==',
    });
    expect(parseDataUrl('https://cdn/a.png')).toBeNull();
  });

  it('解析 inlineData / inline_data；安全拦截与空结果', () => {
    expect(
      parseGeminiImageResponse({
        candidates: [
          {
            content: {
              parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'A' } }, { text: 'hi' }],
            },
          },
        ],
      })
    ).toEqual([{ base64: 'A', mimeType: 'image/jpeg' }]);
    expect(() =>
      parseGeminiImageResponse({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] })
    ).toThrow(expect.objectContaining({ kind: 'content-safety', code: 'IMAGE_SAFETY' }));
    expect(() =>
      parseGeminiImageResponse({ candidates: [{ finishReason: 'IMAGE_PROHIBITED_CONTENT' }] })
    ).toThrow(expect.objectContaining({ kind: 'content-safety' }));
    expect(() =>
      parseGeminiImageResponse({ candidates: [{ content: { parts: [{ text: 'no' }] } }] })
    ).toThrow(expect.objectContaining({ kind: 'invalid-response' }));
  });

  it('x-goog-api-key 鉴权；count > 1 依次请求；测试连接 GET 模型', async () => {
    const { fetch, requests } = mockFetch(imageReply('A'), imageReply('B'), jsonResponse({}));
    const provider = createGeminiImageProvider({ apiKey: 'gk', fetch });
    const result = await provider.generate({ prompt: 'x', count: 2 });
    expect(result).toEqual({
      images: [
        { base64: 'A', mimeType: 'image/png' },
        { base64: 'B', mimeType: 'image/png' },
      ],
      model: 'gemini-nano-banana-2.1',
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe(`${BASE}/models/gemini-nano-banana-2.1:generateContent`);
    expect(requests[0].headers['x-goog-api-key']).toBe('gk');
    expect(requests[0].headers.Authorization).toBeUndefined();
    await provider.testConnection();
    expect(requests[2]).toMatchObject({
      method: 'GET',
      url: `${BASE}/models/gemini-nano-banana-2.1`,
    });
  });

  it('第二张失败时返回已有的；402 / 429 错误可读', async () => {
    const partial = createGeminiImageProvider({
      apiKey: 'k',
      fetch: mockFetch(
        imageReply('A'),
        jsonResponse({ error: { code: 500, message: 'x', status: 'INTERNAL' } }, 500)
      ).fetch,
    });
    expect((await partial.generate({ prompt: 'x', count: 3 })).images).toHaveLength(1);

    const depleted = createGeminiImageProvider({
      apiKey: 'k',
      fetch: mockFetch(
        jsonResponse(
          {
            error: {
              code: 402,
              message: 'Your prepayment credits are depleted.',
              status: 'FAILED_PRECONDITION',
            },
          },
          402
        )
      ).fetch,
    });
    await expect(depleted.generate({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'quota',
      status: 402,
      message: 'Your prepayment credits are depleted.',
    });
    const limited = createGeminiImageProvider({
      apiKey: 'k',
      retry: { retries: 0, baseDelayMs: 0, factor: 1, maxDelayMs: 0 },
      fetch: mockFetch(
        jsonResponse(
          { error: { code: 429, message: 'Too many requests', status: 'RESOURCE_EXHAUSTED' } },
          429
        )
      ).fetch,
    });
    await expect(limited.generate({ prompt: 'x' })).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(() => createGeminiImageProvider({ apiKey: '' })).toThrow('未配置 Gemini API Key');
  });
});

describe('gemini-speech', () => {
  it('请求体：音色、语言、情绪指令', () => {
    expect(
      buildGeminiSpeechBody({
        text: '你好',
        language: 'zh-CN',
        voice: { gender: 'male' },
        emotion: '悲伤',
      })
    ).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'Say in a sad tone: 你好' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
          languageCode: 'zh-CN',
        },
      },
    });
    expect(geminiSpeechDirection('calm')).toBe('Say calmly: ');
    expect(geminiSpeechDirection('随便')).toBe('');
    const voiceOf = (body: Record<string, unknown>) =>
      JSON.stringify(body).match(/"voiceName":"(\w+)"/)?.[1];
    expect(
      voiceOf(buildGeminiSpeechBody({ text: 'x', language: 'en', voice: { gender: 'female' } }))
    ).toBe('Kore');
    expect(voiceOf(buildGeminiSpeechBody({ text: 'x', language: 'en' }))).toBe('Puck');
    expect(voiceOf(buildGeminiSpeechBody({ text: 'x', language: 'en' }, 'Zephyr'))).toBe('Zephyr');
    expect(() => buildGeminiSpeechBody({ text: ' ', language: 'en' })).toThrow('台词不能为空');
  });

  it('PCM 补 WAV 头（按 mimeType 的采样率），WAV 原样使用', () => {
    expect(pcmSampleRate('audio/L16;codec=pcm;rate=16000')).toBe(16000);
    expect(pcmSampleRate(undefined)).toBe(24000);
    const pcm = new Uint8Array(48000); // 1 秒 24kHz s16le
    const result = parseGeminiSpeechResponse({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: toBase64(pcm) } },
            ],
          },
        },
      ],
    });
    expect(result).toMatchObject({ format: 'wav', mimeType: 'audio/wav', durationSec: 1 });
    expect(result.data.byteLength).toBe(48044);

    const wav = pcmToWav(new Uint8Array(16000), 16000);
    expect(wavDurationSec(wav)).toBe(0.5);
    const passthrough = parseGeminiSpeechResponse({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: toBase64(wav) } }] } },
      ],
    });
    expect(passthrough.data).toEqual(wav);
    expect(() => parseGeminiSpeechResponse({ candidates: [{ finishReason: 'SAFETY' }] })).toThrow(
      expect.objectContaining({ kind: 'content-safety' })
    );
    expect(() => parseGeminiSpeechResponse({})).toThrow(
      expect.objectContaining({ kind: 'invalid-response' })
    );
  });

  it('调用 generateContent；测试连接', async () => {
    const pcm = new Uint8Array(2400);
    const { fetch, requests } = mockFetch(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: toBase64(pcm) } }],
            },
          },
        ],
      }),
      jsonResponse({ name: 'models/x' })
    );
    const provider = createGeminiSpeechProvider({ apiKey: 'gk', fetch });
    const result = await provider.synthesize({ text: 'hi', language: 'en-US' });
    expect(result.durationSec).toBe(0.05);
    expect(requests[0].url).toBe(`${BASE}/models/gemini-3.8-flash-tts:generateContent`);
    expect(requests[0].headers['x-goog-api-key']).toBe('gk');
    await provider.testConnection();
    expect(requests[1].url).toBe(`${BASE}/models/gemini-3.8-flash-tts`);
  });
});

describe('gemini-video（Omni）', () => {
  it('比例 / 分辨率 / 请求体', () => {
    expect(['9:16', '3:4', '16:9', '1:1', 'x', undefined].map(geminiVideoAspectRatio)).toEqual([
      '9:16',
      '9:16',
      '16:9',
      '16:9',
      '16:9',
      '16:9',
    ]);
    expect(['480p', '768p', '1080p', undefined].map(geminiVideoResolution)).toEqual([
      '720p',
      '720p',
      '1080p',
      '720p',
    ]);
    expect(
      buildGeminiVideoBody(
        { prompt: '纸船', aspectRatio: '9:16', withAudio: false },
        'gemini-omni-1.1-flash'
      )
    ).toEqual({
      model: 'gemini-omni-1.1-flash',
      input: '纸船',
      response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p', delivery: 'uri' },
      background: true,
    });
    expect(
      buildGeminiVideoBody(
        { prompt: '动起来', firstFrameImage: 'data:image/png;base64,AAA', resolution: '1080p' },
        'm'
      )
    ).toMatchObject({
      input: [
        { type: 'image', data: 'AAA', mime_type: 'image/png' },
        { type: 'text', text: '动起来' },
      ],
      response_format: { resolution: '1080p' },
    });
    // http 首帧无法内联：只发文字
    expect(
      buildGeminiVideoBody({ prompt: 'x', firstFrameImage: 'https://cdn/a.png' }, 'm').input
    ).toBe('x');
    expect(() => buildGeminiVideoBody({ prompt: ' ' }, 'm')).toThrow('不能为空');
  });

  it('宽松提取视频输出', () => {
    expect(
      extractGeminiVideo({
        steps: [
          { type: 'user_input', content: [{ type: 'text', text: 'x' }] },
          {
            type: 'model_output',
            content: [
              {
                type: 'video',
                mime_type: 'video/mp4',
                uri: 'https://g/files/a:download?alt=media',
              },
            ],
          },
        ],
      })
    ).toEqual({ uri: 'https://g/files/a:download?alt=media', mimeType: 'video/mp4' });
    expect(extractGeminiVideo({ outputs: [{ type: 'video', file: 'files/abc' }] })).toEqual({
      file: 'files/abc',
      mimeType: 'video/mp4',
    });
    expect(extractGeminiVideo({ output_video: { mimeType: 'video/mp4', data: 'AAA' } })).toEqual({
      data: 'AAA',
      mimeType: 'video/mp4',
    });
    expect(extractGeminiVideo({ steps: [{ content: [{ type: 'text', text: 'x' }] }] })).toBeNull();
    expect(extractGeminiVideo(null)).toBeNull();
  });

  it('下载地址：uri / files 引用 / 内联 data', () => {
    expect(geminiVideoDownloadUrl({ uri: 'https://x/y.mp4', mimeType: 'video/mp4' }, BASE)).toBe(
      'https://x/y.mp4'
    );
    expect(geminiVideoDownloadUrl({ file: 'files/abc', mimeType: 'video/mp4' }, `${BASE}/`)).toBe(
      `${BASE}/files/abc:download?alt=media`
    );
    expect(geminiVideoDownloadUrl({ uri: 'files/abc', mimeType: 'video/mp4' }, BASE)).toBe(
      `${BASE}/files/abc:download?alt=media`
    );
    expect(geminiVideoDownloadUrl({ data: 'AAA', mimeType: 'video/mp4' }, BASE)).toBe(
      'data:video/mp4;base64,AAA'
    );
  });

  it('状态与错误码映射', () => {
    expect(mapGeminiVideoInteraction({ status: 'in_progress' })).toEqual({ state: 'running' });
    expect(
      mapGeminiVideoInteraction({
        status: 'completed',
        steps: [{ content: [{ type: 'video', data: 'A' }] }],
      } as never)
    ).toEqual({ state: 'succeeded', progress: 100 });
    expect(mapGeminiVideoInteraction({ status: 'completed' })).toMatchObject({
      state: 'failed',
      error: { kind: 'invalid-response' },
    });
    const cases: Array<[string, string]> = [
      ['payment_required', 'quota'],
      ['safety', 'content-safety'],
      ['image_safety', 'content-safety'],
      ['rate_limit_exceeded', 'rate-limit'],
      ['authentication', 'auth'],
      ['something', 'unknown'],
    ];
    for (const [code, kind] of cases) {
      expect(
        mapGeminiVideoInteraction({ status: 'failed', error: { code, message: 'm' } })
      ).toMatchObject({ state: 'failed', error: { kind, code, retryable: false } });
    }
    expect(mapGeminiVideoInteraction({ status: 'cancelled' })).toMatchObject({
      state: 'failed',
      error: { message: 'Gemini 视频任务已取消' },
    });
  });

  it('提交（不重试）→ 轮询 → 取结果（同主机才带 Key 头）→ 取消 / 测试连接', async () => {
    const done = {
      id: 'v1_1',
      status: 'completed',
      steps: [
        {
          type: 'model_output',
          content: [{ type: 'video', uri: `${BASE}/files/f1:download?alt=media` }],
        },
      ],
    };
    const { fetch, requests } = mockFetch(
      jsonResponse({ id: 'v1_1', status: 'in_progress' }),
      jsonResponse({ id: 'v1_1', status: 'in_progress' }),
      jsonResponse(done),
      jsonResponse({ status: 'completed', steps: [{ content: [{ type: 'video', data: 'AAA' }] }] }),
      jsonResponse({
        status: 'completed',
        outputs: [{ type: 'video', uri: 'https://evil.example/x.mp4' }],
      }),
      jsonResponse({}),
      jsonResponse({ name: 'models/gemini-omni-1.1-flash' })
    );
    const provider = createGeminiVideoProvider({ apiKey: 'gk', fetch });
    expect(await provider.submitTask({ prompt: 'x', withAudio: false })).toEqual({
      remoteTaskId: 'v1_1',
    });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/interactions`,
      body: { background: true },
    });
    expect(requests[0].headers['x-goog-api-key']).toBe('gk');
    expect(await provider.pollTask('v1_1')).toEqual({ state: 'running' });
    expect(requests[1].url).toBe(`${BASE}/interactions/v1_1`);
    expect(await provider.fetchResult('v1_1')).toEqual({
      url: `${BASE}/files/f1:download?alt=media`,
      headers: { 'x-goog-api-key': 'gk' },
    });
    expect(await provider.fetchResult('v1_1')).toEqual({ url: 'data:video/mp4;base64,AAA' });
    expect(await provider.fetchResult('v1_1')).toEqual({ url: 'https://evil.example/x.mp4' });
    await provider.cancelTask?.('v1_1');
    expect(requests[5]).toMatchObject({ method: 'POST', url: `${BASE}/interactions/v1_1/cancel` });
    await provider.testConnection();
    expect(requests[6].url).toBe(`${BASE}/models/gemini-omni-1.1-flash`);

    const failing = mockFetch(jsonResponse({ error: { code: 503, message: 'busy' } }, 503));
    const flaky = createGeminiVideoProvider({ apiKey: 'k', fetch: failing.fetch });
    await expect(flaky.submitTask({ prompt: 'x' })).rejects.toMatchObject({ kind: 'server' });
    expect(failing.requests).toHaveLength(1);

    const pending = createGeminiVideoProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse({ status: 'in_progress' })).fetch,
    });
    await expect(pending.fetchResult('x')).rejects.toMatchObject({ kind: 'bad-request' });
  });

  it('注册表', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('gemini-video')).toMatchObject({ kind: 'video', supportsAudio: true });
    expect(registry.createVideo('gemini-video', { apiKey: 'k' }).id).toBe('gemini-video');
    expect(registry.createImage('gemini-image', { apiKey: 'k' }).id).toBe('gemini-image');
    expect(registry.get('gemini-image')?.envKey).toBe('NOVEL_EDITOR_GEMINI_IMAGE_API_KEY');
  });
});
