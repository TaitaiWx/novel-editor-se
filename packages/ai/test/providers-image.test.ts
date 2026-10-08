import { describe, expect, it } from 'vitest';
import {
  buildGrokImageBody,
  buildMinimaxImageBody,
  buildSeedreamImageBody,
  clampImageCount,
  createDefaultRegistry,
  createGrokImageProvider,
  createMinimaxImageProvider,
  createSeedreamImageProvider,
  seedreamSupportsSequential,
  IMAGE_COUNT_MAX,
} from '../src';
import { instantSleep, jsonResponse, mockFetch } from './helpers';

describe('图片 Provider：请求映射', () => {
  it('Seedream：比例 → 像素尺寸，多张参考图，多张候选走组图', () => {
    expect(
      buildSeedreamImageBody(
        {
          prompt: '林舟三视图',
          aspectRatio: '16:9',
          count: 4,
          referenceImages: ['data:image/png;base64,A', 'data:image/png;base64,B'],
        },
        'doubao-seedream-5-0-260128'
      )
    ).toEqual({
      model: 'doubao-seedream-5-0-260128',
      prompt: '林舟三视图',
      size: '2560x1440',
      response_format: 'b64_json',
      watermark: false,
      image: ['data:image/png;base64,A', 'data:image/png;base64,B'],
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 4 },
    });
    const single = buildSeedreamImageBody(
      { prompt: 'x', referenceImages: ['u'], aspectRatio: '7:5' },
      'm'
    );
    expect(single.image).toBe('u');
    expect(single.size).toBe('2048x2048');
    expect(single).not.toHaveProperty('sequential_image_generation');
  });

  // 回归：5.0 pro / flash 不支持组图（真实接口报 sequential_image_generation not valid），改为逐张并行请求
  it('Seedream：只有 5.0 基础版 / 4.x 走组图；pro / flash 并行发多次单张请求再合并', async () => {
    expect(seedreamSupportsSequential('doubao-seedream-5-0-260128')).toBe(true);
    expect(seedreamSupportsSequential('doubao-seedream-4-5-251128')).toBe(true);
    expect(seedreamSupportsSequential('doubao-seedream-5-0-pro-260628')).toBe(false);
    expect(seedreamSupportsSequential('doubao-seedream-5-0-flash-260915')).toBe(false);
    expect(
      buildSeedreamImageBody({ prompt: 'x', count: 4 }, 'doubao-seedream-5-0-pro-260628')
    ).not.toHaveProperty('sequential_image_generation');
    const { fetch, requests } = mockFetch(jsonResponse({ data: [{ b64_json: 'QQ==' }] }));
    const provider = createSeedreamImageProvider({
      apiKey: 'k',
      fetch,
      model: 'doubao-seedream-5-0-pro-260628',
    });
    const result = await provider.generate({ prompt: '林舟', count: 3 });
    expect(requests).toHaveLength(3);
    expect(result.images).toHaveLength(3);
    for (const request of requests) {
      expect(request.body).not.toHaveProperty('sequential_image_generation');
    }
  });

  it('MiniMax：只带第一张参考图（人物参考），返回 base64；Grok 不带参考图', () => {
    expect(
      buildMinimaxImageBody(
        { prompt: '林舟', aspectRatio: '3:4', count: 9, referenceImages: ['a', 'b'], seed: 7 },
        'image-01'
      )
    ).toEqual({
      model: 'image-01',
      prompt: '林舟',
      aspect_ratio: '3:4',
      n: IMAGE_COUNT_MAX,
      response_format: 'base64',
      prompt_optimizer: true,
      subject_reference: [{ type: 'character', image_file: 'a' }],
      seed: 7,
    });
    expect(buildGrokImageBody({ prompt: '雪原', count: 2, referenceImages: ['a'] }, 'g')).toEqual({
      model: 'g',
      prompt: '雪原',
      n: 2,
      response_format: 'b64_json',
    });
    expect([undefined, 0, 2.6, 99, Number.NaN].map(clampImageCount)).toEqual([1, 1, 3, 4, 1]);
    expect(() => buildGrokImageBody({ prompt: '  ' }, 'g')).toThrow('图片描述不能为空');
    expect(
      Array.from(String(buildGrokImageBody({ prompt: '字'.repeat(3000) }, 'g').prompt))
    ).toHaveLength(1500);
  });
});

describe('图片 Provider：调用与错误', () => {
  it('Seedream：Bearer 鉴权，b64 / url 都能取回；不重试', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({ data: [{ b64_json: 'AAA' }, { url: 'https://cdn/x.png' }] })
    );
    // 支持组图的 5.0 基础版：一次请求返回多张
    const provider = createSeedreamImageProvider({
      apiKey: 'k',
      fetch,
      sleep: instantSleep,
      model: 'doubao-seedream-5-0-260128',
    });
    expect(provider.supportsReferences).toBe(true);
    const result = await provider.generate({ prompt: '雪原', count: 2 });
    expect(requests).toHaveLength(1);
    expect(result.images).toEqual([
      { base64: 'AAA', mimeType: 'image/png' },
      { url: 'https://cdn/x.png', mimeType: 'image/png' },
    ]);
    expect(requests[0].url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
    expect(requests[0].headers.Authorization).toBe('Bearer k');

    const failing = mockFetch(
      jsonResponse({ error: { code: 'InternalError', message: 'boom' } }, 500)
    );
    const flaky = createSeedreamImageProvider({
      apiKey: 'k',
      fetch: failing.fetch,
      sleep: instantSleep,
    });
    await expect(flaky.generate({ prompt: 'x' })).rejects.toMatchObject({ kind: 'server' });
    expect(failing.requests).toHaveLength(1);

    const empty = createSeedreamImageProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse({ data: [] })).fetch,
    });
    await expect(empty.generate({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('MiniMax：base_resp 业务错误转 AIError（内容安全 / 鉴权）', async () => {
    const ok = createMinimaxImageProvider({
      apiKey: 'k',
      fetch: mockFetch(
        jsonResponse({ data: { image_base64: ['B64'] }, base_resp: { status_code: 0 } })
      ).fetch,
    });
    expect((await ok.generate({ prompt: 'x' })).images).toEqual([
      { base64: 'B64', mimeType: 'image/jpeg' },
    ]);
    const unsafe = createMinimaxImageProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse({ base_resp: { status_code: 1026, status_msg: '内容不合规' } }))
        .fetch,
    });
    await expect(unsafe.generate({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'content-safety',
      providerId: 'minimax-image',
    });
  });

  it('未配置 Key；Grok 测试连接走 /models；注册表按类型创建', async () => {
    expect(() => createGrokImageProvider({ apiKey: ' ' })).toThrow('未配置xAI API Key');
    const { fetch, requests } = mockFetch(jsonResponse({ data: [] }));
    const grok = createGrokImageProvider({ apiKey: 'k', fetch });
    expect(grok.supportsReferences).toBe(false);
    await grok.testConnection();
    expect(requests[0].url).toBe('https://api.x.ai/v1/models');

    const registry = createDefaultRegistry();
    expect(registry.createImage('seedream-image', { apiKey: 'k', fetch }).kind).toBe('image');
    expect(() => registry.createImage('grok', { apiKey: 'k' })).toThrow('不是图片服务');
    expect(() => registry.createText('seedream-image', { apiKey: 'k' })).toThrow('不是文本服务');
  });
});
