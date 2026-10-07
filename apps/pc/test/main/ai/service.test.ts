import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SafeStorageLike } from '../../../src/main/ai/credential-store';
import { normalizeBaseUrl, ProviderConfigStore } from '../../../src/main/ai/provider-config';
import {
  AIService,
  legacyPayloadToMessages,
  parseDefaultTextSettings,
  sanitizeMessages,
  toCompletionRequest,
} from '../../../src/main/ai/service';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${text}`),
  decryptString: (buffer) => buffer.toString().slice(4),
};

let dir: string;
let settingsJson: string | undefined;
let credentials: CredentialStore;
let configs: ProviderConfigStore;
let service: AIService;
const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ne-ai-service-'));
  credentials = new CredentialStore(path.join(dir, 'cred.json'), safeStorage);
  configs = new ProviderConfigStore(path.join(dir, 'providers.json'));
  settingsJson = JSON.stringify({
    ai: {
      enabled: true,
      enabledExplicitlySet: true,
      baseUrl: 'https://llm.test/v1',
      model: 'm1',
      temperature: 0.4,
      maxTokens: 100,
    },
  });
  service = new AIService({ credentials, configs, readSettings: () => settingsJson });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe('invokeConfiguredAI（与旧版行为一致）', () => {
  it('未启用 / 未配置 Key / 地址模型不完整时返回旧版提示', async () => {
    settingsJson = JSON.stringify({ ai: { enabled: false, enabledExplicitlySet: true } });
    expect(await service.invokeConfiguredAI({ prompt: 'x' })).toEqual({
      ok: false,
      error: 'AI 功能未启用，请先在设置中心开启',
    });
    settingsJson = JSON.stringify({
      ai: { enabled: true, enabledExplicitlySet: true, baseUrl: 'https://a', model: 'm' },
    });
    expect(await service.invokeConfiguredAI({ prompt: 'x' })).toEqual({
      ok: false,
      error: '未配置 AI Key，请先在设置中心填写 API Key',
    });
    credentials.set('openai-compatible', 'sk-1');
    settingsJson = JSON.stringify({
      ai: { enabled: true, enabledExplicitlySet: true, baseUrl: '', model: 'm' },
    });
    expect(await service.invokeConfiguredAI({ prompt: 'x' })).toEqual({
      ok: false,
      error: 'AI Base URL 或模型未配置完整',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('请求与旧版一致：上下文拼接、默认温度与长度、Bearer 鉴权', async () => {
    credentials.set('openai-compatible', 'sk-1');
    fetchMock.mockImplementation(async () => json({ choices: [{ message: { content: '回答' } }] }));
    expect(
      await service.invokeConfiguredAI({ prompt: '问题', systemPrompt: '系统', context: '背景' })
    ).toEqual({ ok: true, text: '回答' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
    expect(lastBody()).toEqual({
      model: 'm1',
      temperature: 0.4,
      max_tokens: 100,
      messages: [
        { role: 'system', content: '系统' },
        { role: 'user', content: '项目上下文:\n背景\n\n用户请求:\n问题' },
      ],
    });
    await service.invokeConfiguredAI({ prompt: 'p', temperature: 0.9, maxTokens: 7 });
    expect(lastBody()).toMatchObject({
      temperature: 0.9,
      max_tokens: 7,
      messages: [{ role: 'user', content: 'p' }],
    });
    settingsJson = JSON.stringify({
      ai: {
        enabled: true,
        enabledExplicitlySet: true,
        baseUrl: 'https://llm.test/v1',
        model: 'm1',
      },
    });
    await service.invokeConfiguredAI({ prompt: 'p' });
    expect(lastBody()).toMatchObject({ temperature: 1.3, max_tokens: 8192 });
  });

  it('错误返回厂商原始信息，不抛异常', async () => {
    credentials.set('openai-compatible', 'sk-1');
    fetchMock.mockImplementation(async () =>
      json({ error: { message: 'Incorrect API key provided' } }, 401)
    );
    expect(await service.invokeConfiguredAI({ prompt: 'x' })).toEqual({
      ok: false,
      error: 'Incorrect API key provided',
    });
    fetchMock.mockImplementation(async () => new Response('<html>', { status: 200 }));
    expect(await service.invokeConfiguredAI({ prompt: 'x' })).toEqual({
      ok: false,
      error: 'AI 服务返回了无效的响应 (HTTP 200)',
    });
  });

  it('旧数据：没有显式开关但安全存储有 Key ⇒ 视为已启用', () => {
    expect(
      parseDefaultTextSettings(JSON.stringify({ baseUrl: 'b', model: 'm' }), true).enabled
    ).toBe(true);
    expect(
      parseDefaultTextSettings(JSON.stringify({ baseUrl: 'b', model: 'm' }), false).enabled
    ).toBe(false);
    expect(parseDefaultTextSettings(JSON.stringify({ apiKey: 'legacy' }), false).enabled).toBe(
      true
    );
    expect(
      parseDefaultTextSettings(JSON.stringify({ enabled: false, enabledExplicitlySet: true }), true)
        .enabled
    ).toBe(false);
    expect(parseDefaultTextSettings('{bad', true)).toMatchObject({
      enabled: true,
      baseUrl: '',
      model: '',
    });
    expect(parseDefaultTextSettings(undefined, false).enabled).toBe(false);
  });
});

describe('Provider 配置', () => {
  it('列表不含密钥，只有 configured', () => {
    credentials.set('grok', 'xai-secret');
    const list = service.listProviders();
    expect(list.map((item) => item.id)).toEqual([
      'openai-compatible',
      'grok',
      'minimax-video',
      'seedance-video',
      'seedream-image',
      'minimax-image',
      'grok-image',
    ]);
    expect(JSON.stringify(list)).not.toContain('xai-secret');
    // 只有公开文档支持生成声音的视频服务带 supportsAudio
    expect(list.find((item) => item.id === 'seedance-video')?.supportsAudio).toBe(true);
    expect(list.find((item) => item.id === 'minimax-video')?.supportsAudio).toBeUndefined();
    expect(list.find((item) => item.id === 'grok')).toMatchObject({
      configured: true,
      enabled: true,
      baseUrl: 'https://api.x.ai/v1',
      secureStorage: true,
    });
    expect(list.find((item) => item.id === 'openai-compatible')).toMatchObject({
      configured: false,
      enabled: true,
      baseUrl: 'https://llm.test/v1',
      model: 'm1',
    });
    expect(list.find((item) => item.id === 'minimax-video')).toMatchObject({
      configured: false,
      currency: 'CNY',
    });
  });

  it('写入 Key / 地址 / 模型 / 单价；清除 Key；校验输入', () => {
    const info = service.updateProvider('seedance-video', {
      apiKey: 'ark-1',
      baseUrl: 'https://ark.test/api/v3/',
      model: 'seed-x',
      pricePerSecond: 0.5,
      enabled: true,
    });
    expect(info).toMatchObject({
      configured: true,
      baseUrl: 'https://ark.test/api/v3',
      model: 'seed-x',
      pricePerSecond: 0.5,
    });
    expect(readFileSync(path.join(dir, 'providers.json'), 'utf-8')).not.toContain('ark-1');
    expect(
      service.updateProvider('seedance-video', {
        clearKey: true,
        pricePerSecond: null,
        baseUrl: '',
      })
    ).toMatchObject({ configured: false, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' });
    expect(() => service.updateProvider('grok', { baseUrl: 'file:///etc/passwd' })).toThrow(
      '只支持 http'
    );
    expect(() => service.updateProvider('grok', { baseUrl: 'https://u:p@x' })).toThrow('账号密码');
    expect(() => service.updateProvider('grok', { model: 'a\nb' })).toThrow('模型名称无效');
    expect(() => service.updateProvider('grok', { pricePerSecond: -1 })).toThrow('非负数');
    expect(() => service.updateProvider('nope', {})).toThrow('未知的 AI 服务');
    expect(() => service.updateProvider('grok', null as never)).toThrow('无效的配置');
    // 默认服务的地址模型由设置中心保存，这里只写 Key
    service.updateProvider('openai-compatible', { apiKey: 'sk-9', baseUrl: 'https://ignored' });
    expect(credentials.get('openai-compatible')).toBe('sk-9');
    expect(configs.get('openai-compatible')).toEqual({});
    expect(() => normalizeBaseUrl('not a url')).toThrow('格式不正确');
    expect(normalizeBaseUrl(42)).toBeUndefined();
  });

  it('getTextProvider / getVideoProvider 的配置检查', () => {
    expect(() => service.getTextProvider('grok')).toThrow('未配置 xAI Grok 的 API Key');
    credentials.set('grok', 'k');
    expect(service.getTextProvider('grok').id).toBe('grok');
    configs.update('grok', { enabled: false });
    expect(() => service.getTextProvider('grok')).toThrow('未启用');
    expect(() => service.getTextProvider('minimax-video')).toThrow('不是文本服务');
    expect(() => service.getVideoProvider('grok')).toThrow('不是视频服务');
    expect(() => service.getVideoProvider('minimax-video')).toThrow('未配置');
    credentials.set('minimax-video', 'k');
    expect(service.getVideoProvider('minimax-video').kind).toBe('video');
    configs.update('minimax-video', { enabled: false });
    expect(() => service.getVideoProvider('minimax-video')).toThrow('未启用');
  });

  it('测试连接使用已保存的 Key', async () => {
    await expect(service.testProvider('grok')).rejects.toThrow('请先填写并保存 API Key');
    credentials.set('grok', 'xai');
    fetchMock.mockImplementation(async () => json({ choices: [] }));
    await service.testProvider('grok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.x.ai/v1/chat/completions');
    credentials.set('openai-compatible', 'sk');
    await service.testProvider('openai-compatible');
    expect(fetchMock.mock.calls[1][0]).toBe('https://llm.test/v1/chat/completions');
    credentials.set('minimax-video', 'mm');
    fetchMock.mockImplementation(async () =>
      json({ base_resp: { status_code: 1004, status_msg: 'auth failed' } })
    );
    await expect(service.testProvider('minimax-video')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('complete / stream 指定 Provider', async () => {
    credentials.set('grok', 'xai');
    fetchMock.mockImplementation(async () =>
      json({ choices: [{ message: { content: 'grok 回答' } }] })
    );
    expect(
      (await service.complete({ providerId: 'grok', messages: [{ role: 'user', content: 'hi' }] }))
        .text
    ).toBe('grok 回答');
    fetchMock.mockImplementation(
      async () => new Response('data: {"choices":[{"delta":{"content":"流"}}]}\n\ndata: [DONE]\n\n')
    );
    const chunks = [];
    for await (const chunk of service.stream({ providerId: 'grok', prompt: 'hi' }))
      chunks.push(chunk);
    expect(chunks[0]).toEqual({ type: 'delta', text: '流' });
  });
});

describe('请求白名单', () => {
  it('消息校验与体量限制', () => {
    expect(() => sanitizeMessages([])).toThrow();
    expect(() => sanitizeMessages([{ role: 'tool', content: 'x' }])).toThrow();
    expect(() => sanitizeMessages([{ role: 'user', content: 1 }])).toThrow();
    expect(() => sanitizeMessages(['x'])).toThrow();
    expect(() => sanitizeMessages([{ role: 'user', content: 'x'.repeat(400_001) }])).toThrow(
      '过长'
    );
    expect(sanitizeMessages([{ role: 'user', content: 'a', extra: 1 }])).toEqual([
      { role: 'user', content: 'a' },
    ]);
    expect(legacyPayloadToMessages({ prompt: 'p' })).toEqual([{ role: 'user', content: 'p' }]);
    expect(() => toCompletionRequest(null as never)).toThrow();
    expect(
      toCompletionRequest({ prompt: 'p', temperature: 5, maxTokens: -1, model: '  m ' })
    ).toEqual({
      messages: [{ role: 'user', content: 'p' }],
      model: 'm',
      temperature: undefined,
      maxTokens: undefined,
    });
  });
});
