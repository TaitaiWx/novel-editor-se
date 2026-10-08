import { describe, expect, it } from 'vitest';
import {
  buildGrokSpeechBody,
  buildGrokVideoBody,
  createDefaultRegistry,
  createGrokSpeechProvider,
  createGrokVideoProvider,
  grokSpeechLanguage,
  grokVideoDuration,
  grokVideoResolution,
  GROK_SPEECH_VOICES,
  GROK_VIDEO_MODEL_FEATURES,
  GROK_VIDEO_REFERENCE_LIMIT,
  mapGrokVideoStatus,
  readGrokSpeechResponse,
  unsupportedGrokField,
} from '../src';
import { instantSleep, jsonResponse, mockFetch } from './helpers';

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe('grok-video：请求映射', () => {
  it('时长、分辨率、比例', () => {
    expect([undefined, 0, 4.4, 15, 30, Number.NaN].map(grokVideoDuration)).toEqual([
      6, 1, 4, 15, 15, 6,
    ]);
    expect(['480p', '768p', '720P', '1080p', '4k', undefined].map(grokVideoResolution)).toEqual([
      '480p',
      '720p',
      '720p',
      '1080p',
      undefined,
      undefined,
    ]);
  });

  it('请求体：首帧 / 参考图（≤7）/ 尾帧 / 声音', () => {
    const refs = Array.from({ length: 9 }, (_, index) => `https://cdn/${index}.png`);
    const body = buildGrokVideoBody(
      {
        prompt: '纸船',
        durationSec: 4,
        aspectRatio: '16:9',
        resolution: '768p',
        firstFrameImage: 'data:image/png;base64,AAA',
        lastFrameImage: 'https://cdn/last.png',
        referenceImages: refs,
        withAudio: false,
      },
      'grok-imagine-video-1.5'
    );
    expect(body).toMatchObject({
      model: 'grok-imagine-video-1.5',
      prompt: '纸船',
      duration: 4,
      aspect_ratio: '16:9',
      resolution: '720p',
      image: { url: 'data:image/png;base64,AAA' },
      last_frame: { url: 'https://cdn/last.png' },
      generate_audio: false,
    });
    // 有首帧：图生视频，不带参考图
    expect(body).not.toHaveProperty('reference_images');
    const withRefs = buildGrokVideoBody(
      { prompt: '纸船', referenceImages: refs },
      'grok-imagine-video-1.5'
    );
    expect(withRefs.reference_images).toHaveLength(GROK_VIDEO_REFERENCE_LIMIT);
    expect((withRefs.reference_images as Array<{ url: string }>)[0]).toEqual({
      url: 'https://cdn/0.png',
    });

    const minimal = buildGrokVideoBody({ prompt: 'x', aspectRatio: '5:7' }, 'm');
    expect(minimal).toEqual({ model: 'm', prompt: 'x', duration: 6 });
    expect(() => buildGrokVideoBody({ prompt: ' ' }, 'm')).toThrow('不能为空');
  });
});

describe('grok-video：不同模型支持的输入', () => {
  const request = {
    prompt: '林舟回头',
    referenceImages: ['https://cdn/a.png'],
    lastFrameImage: 'https://cdn/last.png',
  };

  // 回归：场景视频按人物带三视图参考图，1.5-lite 报「`reference_images` is not supported for this model」
  it('1.5-lite 不带参考图与尾帧；经典模型带参考图不带尾帧；1.5 都带', () => {
    const lite = buildGrokVideoBody(request, 'grok-imagine-video-1.5-lite');
    expect(lite).not.toHaveProperty('reference_images');
    expect(lite).not.toHaveProperty('last_frame');
    const classic = buildGrokVideoBody(request, 'grok-imagine-video');
    expect(classic.reference_images).toEqual([{ url: 'https://cdn/a.png' }]);
    expect(classic).not.toHaveProperty('last_frame');
    const full = buildGrokVideoBody(request, 'grok-imagine-video-1.5');
    expect(full).toHaveProperty('reference_images');
    expect(full).toHaveProperty('last_frame');
    expect(GROK_VIDEO_MODEL_FEATURES['grok-imagine-video-1.5-lite']).toEqual({
      references: false,
      lastFrame: false,
    });
  });

  it('仍报某字段不支持时去掉该字段重新提交；其他错误与必填字段不重试', async () => {
    expect(unsupportedGrokField('`reference_images` is not supported for this model.')).toBe(
      'reference_images'
    );
    expect(unsupportedGrokField('Incorrect API key')).toBeNull();
    const { fetch, requests } = mockFetch(
      jsonResponse(
        { code: 'invalid_argument', error: '`last_frame` is not supported for this model.' },
        400
      ),
      jsonResponse({ request_id: 'r-1' })
    );
    const provider = createGrokVideoProvider({
      apiKey: 'k',
      fetch,
      sleep: instantSleep,
      model: 'future-model',
    });
    expect((await provider.submitTask(request)).remoteTaskId).toBe('r-1');
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toHaveProperty('last_frame');
    expect(requests[1].body).not.toHaveProperty('last_frame');
    expect(requests[1].body).toHaveProperty('reference_images');

    const other = mockFetch(jsonResponse({ error: 'Incorrect API key provided' }, 400));
    const failing = createGrokVideoProvider({
      apiKey: 'k',
      fetch: other.fetch,
      sleep: instantSleep,
    });
    await expect(failing.submitTask(request)).rejects.toBeTruthy();
    expect(other.requests).toHaveLength(1);
  });
});

describe('grok-video：轮询与错误', () => {
  it('状态映射', () => {
    expect(mapGrokVideoStatus({ status: 'pending', progress: 42 })).toEqual({
      state: 'running',
      progress: 42,
    });
    expect(mapGrokVideoStatus({ status: 'pending' })).toEqual({ state: 'running' });
    expect(
      mapGrokVideoStatus({
        status: 'done',
        video: { url: 'https://vidgen.x.ai/a.mp4', respect_moderation: true },
      })
    ).toEqual({ state: 'succeeded', progress: 100, resultUrl: 'https://vidgen.x.ai/a.mp4' });
    expect(
      mapGrokVideoStatus({ status: 'done', video: { url: '', respect_moderation: false } })
    ).toMatchObject({ state: 'failed', error: { kind: 'content-safety', retryable: false } });
    const cases: Array<[string, string]> = [
      ['invalid_argument', 'bad-request'],
      ['permission_denied', 'auth'],
      ['service_unavailable', 'server'],
      ['internal_error', 'server'],
      ['weird', 'unknown'],
    ];
    for (const [code, kind] of cases) {
      expect(mapGrokVideoStatus({ status: 'failed', error: { code, message: 'm' } })).toMatchObject(
        { state: 'failed', error: { kind, code, message: 'm', retryable: false } }
      );
    }
  });

  it('提交不重试、轮询、取结果、测试连接', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({ request_id: 'req-1' }),
      jsonResponse({ status: 'pending', progress: 10 }),
      jsonResponse({ status: 'done', video: { url: 'https://v/x.mp4', respect_moderation: true } }),
      jsonResponse({ status: 'done', video: { url: 'https://v/x.mp4', respect_moderation: true } }),
      jsonResponse({ data: [] })
    );
    const provider = createGrokVideoProvider({ apiKey: 'k', fetch });
    expect(await provider.submitTask({ prompt: 'x', durationSec: 4 })).toEqual({
      remoteTaskId: 'req-1',
    });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.x.ai/v1/videos/generations',
      body: { duration: 4 },
    });
    expect(requests[0].headers.Authorization).toBe('Bearer k');
    expect(await provider.pollTask('req-1')).toEqual({ state: 'running', progress: 10 });
    expect(requests[1]).toMatchObject({ method: 'GET', url: 'https://api.x.ai/v1/videos/req-1' });
    expect((await provider.pollTask('req-1')).state).toBe('succeeded');
    expect(await provider.fetchResult('req-1')).toEqual({ url: 'https://v/x.mp4' });
    await provider.testConnection();
    expect(requests[4].url).toBe('https://api.x.ai/v1/models');

    const failing = mockFetch(jsonResponse({ error: 'overloaded' }, 503));
    const flaky = createGrokVideoProvider({
      apiKey: 'k',
      fetch: failing.fetch,
      sleep: instantSleep,
    });
    await expect(flaky.submitTask({ prompt: 'x' })).rejects.toMatchObject({ kind: 'server' });
    expect(failing.requests).toHaveLength(1);

    const pending = createGrokVideoProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse({ status: 'pending' })).fetch,
    });
    await expect(pending.fetchResult('r')).rejects.toMatchObject({ kind: 'bad-request' });
    const noId = createGrokVideoProvider({ apiKey: 'k', fetch: mockFetch(jsonResponse({})).fetch });
    await expect(noId.submitTask({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    expect(() => createGrokVideoProvider({ apiKey: '' })).toThrow('未配置 xAI API Key');
  });

  it('注册表：带声音的视频服务', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('grok-video')).toMatchObject({
      kind: 'video',
      supportsAudio: true,
      defaultModel: 'grok-imagine-video-1.5',
    });
    expect(registry.createVideo('grok-video', { apiKey: 'k' }).id).toBe('grok-video');
  });
});

describe('grok-speech', () => {
  it('语言映射', () => {
    expect(
      [
        'zh-CN',
        'zh-TW',
        'en-US',
        'ja-JP',
        'ko',
        'fr-FR',
        'es-MX',
        'es',
        'pt-PT',
        'pt',
        'de',
        'vi-VN',
        'th-TH',
        '',
      ].map(grokSpeechLanguage)
    ).toEqual([
      'zh',
      'zh',
      'en',
      'ja',
      'ko',
      'fr',
      'es-MX',
      'es-ES',
      'pt-PT',
      'pt-BR',
      'de',
      'vi',
      'auto',
      'auto',
    ]);
  });

  it('请求体：音色按性别 / 指定 / 设置中心默认；不发送 model 与情绪', () => {
    expect(
      buildGrokSpeechBody({ text: ' 你好 ', language: 'zh-CN', voice: { gender: 'male' } })
    ).toEqual({
      text: '你好',
      language: 'zh',
      voice_id: 'rex',
      output_format: { codec: 'mp3', sample_rate: 24000 },
    });
    expect(
      buildGrokSpeechBody({
        text: 'x',
        language: 'en',
        voice: { gender: 'female' },
        emotion: 'sad',
      })
    ).toMatchObject({ voice_id: 'eve', text: 'x' });
    expect(buildGrokSpeechBody({ text: 'x', language: 'en' }, 'leo').voice_id).toBe('leo');
    expect(buildGrokSpeechBody({ text: 'x', language: 'en' }).voice_id).toBe('ara');
    expect(
      buildGrokSpeechBody({ text: 'x', language: 'en', voice: { providerVoiceId: 'Orion' } })
        .voice_id
    ).toBe('Orion');
    expect(buildGrokSpeechBody({ text: 'x', language: 'en', format: 'wav' }).output_format).toEqual(
      {
        codec: 'wav',
        sample_rate: 24000,
      }
    );
    expect(() => buildGrokSpeechBody({ text: '', language: 'en' })).toThrow('台词不能为空');
    expect(GROK_SPEECH_VOICES.female).toContain('eve');
    expect(GROK_SPEECH_VOICES.male).toContain('rex');
  });

  it('响应：音频字节或 JSON（base64）', async () => {
    const raw = await readGrokSpeechResponse(
      new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg' } }),
      'mp3'
    );
    expect(raw).toMatchObject({ format: 'mp3', mimeType: 'audio/mpeg' });
    const json = await readGrokSpeechResponse(
      jsonResponse({ audio: toBase64(MP3), content_type: 'audio/mpeg', duration: 1.5 }),
      'mp3'
    );
    expect(json).toMatchObject({ format: 'mp3', durationSec: 1.5 });
    await expect(readGrokSpeechResponse(jsonResponse({}), 'mp3')).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    await expect(
      readGrokSpeechResponse(
        new Response('nope', { headers: { 'Content-Type': 'audio/mpeg' } }),
        'mp3'
      )
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('调用 /tts、测试连接 /tts/voices、错误映射', async () => {
    const { fetch, requests } = mockFetch(
      new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg' } }),
      jsonResponse({ voices: [] })
    );
    const provider = createGrokSpeechProvider({ apiKey: 'k', fetch });
    const result = await provider.synthesize({ text: '你好', language: 'zh-CN' });
    expect(result.format).toBe('mp3');
    expect(requests[0]).toMatchObject({ method: 'POST', url: 'https://api.x.ai/v1/tts' });
    expect(requests[0].headers.Authorization).toBe('Bearer k');
    await provider.testConnection();
    expect(requests[1]).toMatchObject({ method: 'GET', url: 'https://api.x.ai/v1/tts/voices' });

    const unauthorized = createGrokSpeechProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse({ error: 'Incorrect API key provided' }, 401)).fetch,
    });
    await expect(unauthorized.synthesize({ text: 'x', language: 'en' })).rejects.toMatchObject({
      kind: 'auth',
      providerId: 'grok-speech',
    });
    expect(() => createGrokSpeechProvider({ apiKey: '' })).toThrow('未配置 xAI API Key');
  });
});
