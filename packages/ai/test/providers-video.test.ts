import { describe, expect, it } from 'vitest';
import {
  buildMinimaxSubmitBody,
  buildSeedanceSubmitBody,
  createMinimaxVideoProvider,
  createSeedanceVideoProvider,
  mapMinimaxStatus,
  mapSeedanceStatus,
  MINIMAX_VIDEO_DEFAULTS,
  minimaxBaseRespError,
  normalizeMinimaxDuration,
  SEEDANCE_VIDEO_DEFAULTS,
} from '../src';
import { instantSleep, jsonResponse, mockFetch } from './helpers';

const ok = { status_code: 0, status_msg: 'success' };

describe('minimax-video', () => {
  it('请求体映射快照', () => {
    expect(
      buildMinimaxSubmitBody(
        {
          prompt: '月夜雪原，林舟独立',
          durationSec: 9,
          resolution: '768p',
          firstFrameImage: 'data:image/png;base64,AAA',
          aspectRatio: '16:9',
        },
        'MiniMax-Hailuo-02'
      )
    ).toMatchInlineSnapshot(`
      {
        "duration": 10,
        "first_frame_image": "data:image/png;base64,AAA",
        "model": "MiniMax-Hailuo-02",
        "prompt": "月夜雪原，林舟独立",
        "prompt_optimizer": true,
        "resolution": "768P",
      }
    `);
    expect(
      buildMinimaxSubmitBody({ prompt: 'x'.repeat(3000), model: 'T2V-01' }, 'd')
    ).toMatchObject({
      model: 'T2V-01',
      prompt: 'x'.repeat(2000),
    });
    expect([undefined, 3, 6, 8, 8.5, 12, Number.NaN].map(normalizeMinimaxDuration)).toEqual([
      undefined,
      6,
      6,
      6,
      10,
      10,
      undefined,
    ]);
  });

  it('状态映射与 base_resp 错误码', () => {
    expect(
      ['Preparing', 'Queueing', 'Processing', 'Success', 'Fail', undefined].map(mapMinimaxStatus)
    ).toEqual(['queued', 'queued', 'running', 'succeeded', 'failed', 'queued']);
    expect(minimaxBaseRespError(ok)).toBeNull();
    expect(minimaxBaseRespError(undefined)).toBeNull();
    const cases: Array<[number, string]> = [
      [1002, 'rate-limit'],
      [1004, 'auth'],
      [2049, 'auth'],
      [1008, 'quota'],
      [1026, 'content-safety'],
      [2013, 'bad-request'],
      [9999, 'unknown'],
    ];
    for (const [code, kind] of cases) {
      expect(minimaxBaseRespError({ status_code: code, status_msg: 'm' })).toMatchObject({
        kind,
        code: String(code),
      });
    }
  });

  it('提交 → 轮询 → 取下载地址', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({ task_id: 't-1', base_resp: ok }),
      jsonResponse({ task_id: 't-1', status: 'Processing', base_resp: ok }),
      jsonResponse({ task_id: 't-1', status: 'Success', file_id: 42, base_resp: ok }),
      jsonResponse({ task_id: 't-1', status: 'Success', file_id: 42, base_resp: ok }),
      jsonResponse({ file: { file_id: 42, download_url: 'https://cdn/v.mp4' }, base_resp: ok })
    );
    const provider = createMinimaxVideoProvider({ apiKey: 'mm', fetch });
    expect(await provider.submitTask({ prompt: 'p', durationSec: 6 })).toEqual({
      remoteTaskId: 't-1',
    });
    expect(await provider.pollTask('t-1')).toEqual({ state: 'running' });
    expect(await provider.pollTask('t-1')).toEqual({ state: 'succeeded' });
    expect(await provider.fetchResult('t-1')).toEqual({ url: 'https://cdn/v.mp4' });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${MINIMAX_VIDEO_DEFAULTS.baseUrl}/v1/video_generation`,
      `GET ${MINIMAX_VIDEO_DEFAULTS.baseUrl}/v1/query/video_generation?task_id=t-1`,
      `GET ${MINIMAX_VIDEO_DEFAULTS.baseUrl}/v1/query/video_generation?task_id=t-1`,
      `GET ${MINIMAX_VIDEO_DEFAULTS.baseUrl}/v1/query/video_generation?task_id=t-1`,
      `GET ${MINIMAX_VIDEO_DEFAULTS.baseUrl}/v1/files/retrieve?file_id=42`,
    ]);
    expect(requests[0].headers.Authorization).toBe('Bearer mm');
    expect(requests[0].body).toMatchObject({ model: MINIMAX_VIDEO_DEFAULTS.model, duration: 6 });
  });

  it('HTTP 200 + 业务错误码：内容安全 / 余额不足', async () => {
    const { fetch } = mockFetch(
      jsonResponse({ base_resp: { status_code: 1026, status_msg: 'input sensitive' } }),
      jsonResponse({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } })
    );
    const provider = createMinimaxVideoProvider({ apiKey: 'k', fetch });
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({
      kind: 'content-safety',
    });
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({ kind: 'quota' });
  });

  it('提交不重试（避免重复扣费），没有 task_id 报 invalid-response', async () => {
    const { fetch, requests } = mockFetch(jsonResponse({}, 503), jsonResponse({ base_resp: ok }));
    const provider = createMinimaxVideoProvider({
      apiKey: 'k',
      fetch,
      sleep: instantSleep().sleep,
    });
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({ kind: 'server' });
    expect(requests).toHaveLength(1);
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('任务失败返回规范化错误；未完成时 fetchResult 报错', async () => {
    const { fetch } = mockFetch(
      jsonResponse({
        status: 'Fail',
        base_resp: { status_code: 1027, status_msg: 'output sensitive' },
      }),
      jsonResponse({ status: 'Fail', base_resp: ok }),
      jsonResponse({ status: 'Processing', base_resp: ok }),
      jsonResponse({ status: 'Success', file_id: 1, base_resp: ok }),
      jsonResponse({ file: {}, base_resp: ok })
    );
    const provider = createMinimaxVideoProvider({ apiKey: 'k', fetch });
    expect(await provider.pollTask('t')).toMatchObject({
      state: 'failed',
      error: { kind: 'content-safety' },
    });
    expect(await provider.pollTask('t')).toMatchObject({
      state: 'failed',
      error: { kind: 'unknown' },
    });
    await expect(provider.fetchResult('t')).rejects.toMatchObject({ retryable: true });
    await expect(provider.fetchResult('t')).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('testConnection：鉴权错误失败，其他错误码视为可用', async () => {
    const { fetch } = mockFetch(
      jsonResponse({ base_resp: { status_code: 2049, status_msg: 'invalid api key' } }),
      jsonResponse({ base_resp: { status_code: 2013, status_msg: 'task not found' } })
    );
    const provider = createMinimaxVideoProvider({
      apiKey: 'k',
      fetch,
      baseUrl: 'https://api.minimax.io',
    });
    await expect(provider.testConnection()).rejects.toMatchObject({ kind: 'auth' });
    await expect(provider.testConnection()).resolves.toBeUndefined();
    expect(() => createMinimaxVideoProvider({ apiKey: '' })).toThrow(/MiniMax/);
  });
});

describe('seedance-video', () => {
  it('请求体映射快照：参数放在请求体 / 文本命令', () => {
    const request = {
      prompt: '狼王从雾中现身',
      durationSec: 5.4,
      aspectRatio: '16:9',
      resolution: '720P',
      watermark: false,
      seed: 7,
      firstFrameImage: 'https://img/1.png',
    };
    expect(buildSeedanceSubmitBody(request, 'doubao-seedance-1-0-pro-250528'))
      .toMatchInlineSnapshot(`
      {
        "content": [
          {
            "text": "狼王从雾中现身",
            "type": "text",
          },
          {
            "image_url": {
              "url": "https://img/1.png",
            },
            "role": "first_frame",
            "type": "image_url",
          },
        ],
        "duration": 5,
        "model": "doubao-seedance-1-0-pro-250528",
        "ratio": "16:9",
        "resolution": "720p",
        "seed": 7,
        "watermark": false,
      }
    `);
    expect(
      buildSeedanceSubmitBody(
        { prompt: 'p', durationSec: 5, aspectRatio: '9:16' },
        'm',
        'text-command'
      )
    ).toEqual({
      model: 'm',
      content: [{ type: 'text', text: 'p --ratio 9:16 --duration 5' }],
    });
  });

  it('状态映射', () => {
    expect(
      ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired', 'x'].map(
        mapSeedanceStatus
      )
    ).toEqual(['queued', 'running', 'succeeded', 'failed', 'failed', 'failed', 'queued']);
  });

  it('提交 → 轮询（成功时直接给出地址）→ fetchResult', async () => {
    const { fetch, requests } = mockFetch(
      jsonResponse({ id: 'cgt-1' }),
      jsonResponse({ id: 'cgt-1', status: 'running' }),
      jsonResponse({
        id: 'cgt-1',
        status: 'succeeded',
        content: { video_url: 'https://tos/v.mp4' },
      }),
      jsonResponse({
        id: 'cgt-1',
        status: 'succeeded',
        content: { video_url: 'https://tos/v2.mp4' },
      })
    );
    const provider = createSeedanceVideoProvider({ apiKey: 'ark', fetch });
    expect(await provider.submitTask({ prompt: 'p' })).toEqual({ remoteTaskId: 'cgt-1' });
    expect(await provider.pollTask('cgt-1')).toEqual({ state: 'running' });
    expect(await provider.pollTask('cgt-1')).toEqual({
      state: 'succeeded',
      progress: 100,
      resultUrl: 'https://tos/v.mp4',
    });
    expect((await provider.fetchResult('cgt-1')).url).toBe('https://tos/v2.mp4');
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${SEEDANCE_VIDEO_DEFAULTS.baseUrl}/contents/generations/tasks`,
      `GET ${SEEDANCE_VIDEO_DEFAULTS.baseUrl}/contents/generations/tasks/cgt-1`,
      `GET ${SEEDANCE_VIDEO_DEFAULTS.baseUrl}/contents/generations/tasks/cgt-1`,
      `GET ${SEEDANCE_VIDEO_DEFAULTS.baseUrl}/contents/generations/tasks/cgt-1`,
    ]);
    expect(requests[0].headers.Authorization).toBe('Bearer ark');
  });

  it('错误映射：鉴权 / 内容安全 / 欠费 / 任务失败', async () => {
    const { fetch } = mockFetch(
      jsonResponse(
        { error: { code: 'AuthenticationError', message: 'the API key is invalid' } },
        401
      ),
      jsonResponse(
        { error: { code: 'InputTextSensitiveContentDetected', message: 'rejected' } },
        400
      ),
      jsonResponse({ error: { code: 'AccountOverdueError', message: 'overdue' } }, 403),
      jsonResponse({
        status: 'failed',
        error: { code: 'OutputVideoSensitiveContentDetected', message: 'blocked' },
      }),
      jsonResponse({ status: 'expired' })
    );
    const provider = createSeedanceVideoProvider({ apiKey: 'k', fetch });
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({ kind: 'auth' });
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({
      kind: 'content-safety',
    });
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({ kind: 'quota' });
    expect(await provider.pollTask('t')).toMatchObject({
      state: 'failed',
      error: {
        kind: 'content-safety',
        code: 'OutputVideoSensitiveContentDetected',
        retryable: false,
      },
    });
    expect(await provider.pollTask('t')).toMatchObject({
      state: 'failed',
      error: { message: 'Seedance 任务已过期' },
    });
  });

  it('取消、测试连接、未完成的 fetchResult、缺少 id', async () => {
    const { fetch, requests } = mockFetch(
      new Response('', { status: 200 }),
      jsonResponse({ items: [], total: 0 }),
      jsonResponse({ status: 'running' }),
      jsonResponse({})
    );
    const provider = createSeedanceVideoProvider({
      apiKey: 'k',
      fetch,
      baseUrl: 'http://127.0.0.1:9/api/v3',
    });
    await expect(provider.cancelTask?.('a/b')).resolves.toBeUndefined();
    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      url: 'http://127.0.0.1:9/api/v3/contents/generations/tasks/a%2Fb',
    });
    await expect(provider.testConnection()).resolves.toBeUndefined();
    expect(requests[1].url).toContain('page_num=1&page_size=1');
    await expect(provider.fetchResult('t')).rejects.toMatchObject({ retryable: true });
    await expect(provider.submitTask({ prompt: 'p' })).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    expect(() => createSeedanceVideoProvider({ apiKey: '' })).toThrow(/火山方舟/);
  });
});
