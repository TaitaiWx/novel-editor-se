import { describe, expect, it } from 'vitest';
import {
  ARK_MODEL_ACCESS_HINT,
  buildOpenAIImageBody,
  createDefaultRegistry,
  createOpenAIImageProvider,
  createSeedanceVideoProvider,
  createSeedreamImageProvider,
  describeAIError,
  openAIImageSize,
  OPENAI_IMAGE_DEFAULTS,
  parseOpenAIImageResponse,
  SEEDREAM_IMAGE_DEFAULTS,
} from '../src';
import { instantSleep, jsonResponse, mockFetch } from './helpers';

describe('openai-image：请求映射', () => {
  it('比例 → 尺寸', () => {
    expect(
      ['1:1', '3:4', '2:3', '9:16', '4:5', '4:3', '3:2', '16:9', '5:4', '21:9', undefined].map(
        openAIImageSize
      )
    ).toEqual([
      '1024x1024',
      '1024x1536',
      '1024x1536',
      '1024x1536',
      '1024x1536',
      '1536x1024',
      '1536x1024',
      '1536x1024',
      '1536x1024',
      'auto',
      '1024x1024',
    ]);
  });

  it('文生图走 generations，不发送 response_format / style', () => {
    const { endpoint, body } = buildOpenAIImageBody(
      { prompt: ' 灯塔 ', aspectRatio: '16:9', count: 9 },
      'gpt-image-2'
    );
    expect(endpoint).toBe('/images/generations');
    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: '灯塔',
      n: 4,
      size: '1536x1024',
      output_format: 'png',
    });
    expect(buildOpenAIImageBody({ prompt: 'x', quality: 'high' }, 'm').body.quality).toBe('high');
    expect(() => buildOpenAIImageBody({ prompt: '  ' }, 'm')).toThrow('不能为空');
  });

  it('有参考图走 edits（JSON 的 images[].image_url）', () => {
    const { endpoint, body } = buildOpenAIImageBody(
      {
        prompt: '林舟三视图',
        model: 'gpt-image-2.5-flare',
        referenceImages: ['data:image/png;base64,AAA', 'https://cdn/a.png', ''],
      },
      'gpt-image-2'
    );
    expect(endpoint).toBe('/images/edits');
    expect(body).toMatchObject({
      model: 'gpt-image-2.5-flare',
      images: [{ image_url: 'data:image/png;base64,AAA' }, { image_url: 'https://cdn/a.png' }],
      n: 1,
      size: '1024x1024',
    });
  });

  it('解析 b64_json；没有图片时报 invalid-response', () => {
    expect(parseOpenAIImageResponse({ data: [{ b64_json: 'AAA' }] })).toEqual([
      { base64: 'AAA', mimeType: 'image/png' },
    ]);
    expect(
      parseOpenAIImageResponse({ data: [{ b64_json: 'B' }], output_format: 'webp' })[0].mimeType
    ).toBe('image/webp');
    expect(() => parseOpenAIImageResponse({ data: [] })).toThrow('没有返回图片');
  });
});

describe('openai-image：调用与错误', () => {
  it('Bearer 鉴权、默认地址；不重试；测试连接 GET /models', async () => {
    const { fetch, requests } = mockFetch(jsonResponse({ data: [{ b64_json: 'AAA' }] }));
    const provider = createOpenAIImageProvider({ apiKey: 'k', fetch });
    expect(provider.supportsReferences).toBe(true);
    const result = await provider.generate({ prompt: '灯塔' });
    expect(result).toEqual({
      images: [{ base64: 'AAA', mimeType: 'image/png' }],
      model: OPENAI_IMAGE_DEFAULTS.model,
    });
    expect(requests[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect(requests[0].headers.Authorization).toBe('Bearer k');
    await provider.testConnection();
    expect(requests[1]).toMatchObject({ method: 'GET', url: 'https://api.openai.com/v1/models' });

    const failing = mockFetch(jsonResponse({ error: { message: 'boom' } }, 500));
    const flaky = createOpenAIImageProvider({
      apiKey: 'k',
      fetch: failing.fetch,
      sleep: instantSleep,
    });
    await expect(flaky.generate({ prompt: 'x' })).rejects.toMatchObject({ kind: 'server' });
    expect(failing.requests).toHaveLength(1);
  });

  it('moderation_blocked → content-safety；未配置 Key', async () => {
    const blocked = createOpenAIImageProvider({
      apiKey: 'k',
      fetch: mockFetch(
        jsonResponse(
          {
            error: {
              code: 'moderation_blocked',
              message: 'Your request was rejected by the safety system.',
              type: 'image_generation_user_error',
            },
          },
          400
        )
      ).fetch,
    });
    await expect(blocked.generate({ prompt: 'x' })).rejects.toMatchObject({
      kind: 'content-safety',
      code: 'moderation_blocked',
      providerId: 'openai-image',
    });
    expect(() => createOpenAIImageProvider({ apiKey: '' })).toThrow('未配置 OpenAI API Key');
    expect(createDefaultRegistry().createImage('openai-image', { apiKey: 'k' }).id).toBe(
      'openai-image'
    );
  });
});

describe('火山方舟：模型未开通的提示', () => {
  const notFound = {
    error: {
      code: 'InvalidEndpointOrModel.NotFound',
      message:
        'The model or endpoint doubao-seedream-5-0-260128 does not exist or you do not have access to it.',
    },
  };

  it('Seedream 默认模型与顺序', () => {
    expect(SEEDREAM_IMAGE_DEFAULTS.model).toBe('doubao-seedream-5-0-pro-260628');
    expect(SEEDREAM_IMAGE_DEFAULTS.models[0]).toBe(SEEDREAM_IMAGE_DEFAULTS.model);
  });

  it('Seedream / Seedance 的「不存在或无权访问」追加开通提示', async () => {
    const seedream = createSeedreamImageProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse(notFound, 404)).fetch,
    });
    const error = await seedream.generate({ prompt: 'x' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'bad-request', status: 404, providerId: 'seedream-image' });
    expect((error as Error).message).toContain(ARK_MODEL_ACCESS_HINT);
    expect(describeAIError(error as never)).toContain(ARK_MODEL_ACCESS_HINT);

    const seedance = createSeedanceVideoProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse(notFound, 404)).fetch,
    });
    await expect(seedance.submitTask({ prompt: 'x' })).rejects.toThrow(ARK_MODEL_ACCESS_HINT);

    const other = createSeedreamImageProvider({
      apiKey: 'k',
      fetch: mockFetch(jsonResponse({ error: { message: 'bad size' } }, 400)).fetch,
    });
    const plain = await other.generate({ prompt: 'x' }).catch((e: unknown) => e);
    expect((plain as Error).message).toBe('bad size');
  });
});
