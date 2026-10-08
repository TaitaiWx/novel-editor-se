import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SafeStorageLike } from '../../../src/main/ai/credential-store';
import { ProviderConfigStore } from '../../../src/main/ai/provider-config';
import { AIService } from '../../../src/main/ai/service';

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

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastRequest(): { url: string; auth: string; body: Record<string, unknown> | null } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  const headers = new Headers(init.headers);
  return {
    url: String(url),
    auth: headers.get('authorization') ?? '',
    body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
  };
}

function newService() {
  return new AIService({
    credentials,
    configs,
    readSettings: () => settingsJson,
    clock: () => new Date('2026-01-01T00:00:00Z'),
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ne-ai-media-'));
  credentials = new CredentialStore(path.join(dir, 'cred.json'), safeStorage);
  configs = new ProviderConfigStore(path.join(dir, 'providers.json'));
  settingsJson = JSON.stringify({
    ai: {
      enabled: true,
      enabledExplicitlySet: true,
      baseUrl: 'https://builtin.test/v1',
      model: 'builtin-model',
      temperature: 1.1,
      maxTokens: 4096,
      contextTokens: 64000,
    },
  });
  service = newService();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    json({ model: 'x', choices: [{ message: { content: 'ok' } }], items: [], data: [] })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe('自定义视频 / 图片 / 语音服务', () => {
  it('添加 / 列出 / 改名 / 删除；编号按类型只增不减；沿用厂商描述', () => {
    const video = service.addCustomProvider({
      kind: 'video',
      vendor: 'seedance-video',
      label: ' Seedance 工作室 ',
      baseUrl: 'https://ark.example.test/api/v3/',
      pricePerSecond: 0.5,
      apiKey: 'ark-studio',
    });
    expect(video).toMatchObject({
      id: 'custom-video-1',
      kind: 'video',
      label: 'Seedance 工作室',
      custom: true,
      vendor: 'seedance-video',
      supportsAudio: true,
      configured: true,
      enabled: true,
      baseUrl: 'https://ark.example.test/api/v3',
      pricePerSecond: 0.5,
    });
    // 模型留空沿用厂商默认
    expect(video.model).toBe(service.getProviderInfo('seedance-video').defaultModel);

    const speech = service.addCustomProvider({
      kind: 'speech',
      vendor: 'openai-speech',
      label: '自建 TTS',
      baseUrl: 'http://127.0.0.1:8880/v1',
      voice: 'nova',
    });
    expect(speech).toMatchObject({
      id: 'custom-speech-1',
      kind: 'speech',
      vendor: 'openai-speech',
      voice: 'nova',
      configured: false,
      enabled: false,
    });
    const image = service.addCustomProvider({
      kind: 'image',
      vendor: 'minimax-image',
      label: 'MiniMax 图片 2',
    });
    expect(image.id).toBe('custom-image-1');
    // 地址留空 = 厂商默认
    expect(image.baseUrl).toBe(service.getProviderInfo('minimax-image').defaultBaseUrl);

    const list = service.listProviders();
    expect(list.filter((item) => item.custom).map((item) => `${item.kind}:${item.id}`)).toEqual([
      'video:custom-video-1',
      'speech:custom-speech-1',
      'image:custom-image-1',
    ]);

    expect(service.updateProvider('custom-video-1', { label: '方舟 B' }).label).toBe('方舟 B');
    expect(service.removeCustomProvider('custom-video-1')).toBe(true);
    expect(credentials.has('custom-video-1')).toBe(false);
    const again = service.addCustomProvider({
      kind: 'video',
      vendor: 'minimax-video',
      label: '海螺 2',
    });
    expect(again.id).toBe('custom-video-2');
    expect(again.supportsAudio).toBeUndefined();

    // 配置持久化：新实例读到同样的列表
    const reopened = newService();
    expect(
      reopened
        .listProviders()
        .filter((item) => item.custom)
        .map((item) => item.id)
    ).toEqual(['custom-speech-1', 'custom-image-1', 'custom-video-2']);
    const file = readFileSync(path.join(dir, 'providers.json'), 'utf-8');
    expect(file).toContain('"vendor": "openai-speech"');
    expect(file).not.toContain('ark-studio');
  });

  it('输入校验：类型、厂商、名称、地址；失败不留登记', () => {
    const bad = [
      [{ kind: 'video', vendor: 'grok', label: 'x' }, '请选择支持的服务类型'],
      [{ kind: 'video', vendor: 'openai-speech', label: 'x' }, '请选择支持的服务类型'],
      [{ kind: 'speech', label: 'x' }, '请选择支持的服务类型'],
      [{ kind: 'music', vendor: 'x', label: 'x' }, '无效的服务类型'],
      [{ kind: 'video', vendor: 'seedance-video', label: '' }, '名称不能为空'],
      [{ kind: 'video', vendor: 'seedance-video', label: 'x', baseUrl: 'ftp://x' }, '只支持 http'],
      [
        { kind: 'video', vendor: 'seedance-video', label: 'x', pricePerSecond: -1 },
        '单价必须是非负数',
      ],
      [{ kind: 'speech', vendor: 'openai-speech', label: 'x', voice: 'a\nb' }, '声音名称无效'],
    ] as const;
    for (const [input, message] of bad) {
      expect(() => service.addCustomProvider(input as never)).toThrow(message);
    }
    expect(configs.listCustomMedia()).toEqual([]);
    for (const id of ['seedance-video', 'custom-video-', 'custom-music-1', 'custom-video-1/..']) {
      expect(() => service.removeCustomProvider(id)).toThrow('只能删除自己添加的');
    }
    expect(() => service.updateProvider('seedance-video', { label: 'x' })).toThrow(
      '只能给自己添加的服务改名'
    );
  });

  it('注册表按厂商实例化：使用自己的地址与 Key；Key 按 id 隔离', async () => {
    credentials.set('seedance-video', 'ark-builtin');
    service.addCustomProvider({
      kind: 'video',
      vendor: 'seedance-video',
      label: '方舟 B',
      baseUrl: 'https://ark-b.test/api/v3',
      apiKey: 'ark-b',
    });
    await service.testProvider('custom-video-1');
    expect(lastRequest().url.startsWith('https://ark-b.test/api/v3/')).toBe(true);
    expect(lastRequest().auth).toBe('Bearer ark-b');
    expect(service.getVideoProvider('custom-video-1')).toBeTruthy();

    service.addCustomProvider({
      kind: 'speech',
      vendor: 'openai-speech',
      label: '自建 TTS',
      baseUrl: 'http://127.0.0.1:8880/v1',
      apiKey: 'tts-key',
    });
    // 已配置的自定义语音服务出现在「可用配音服务」里，并可直接取得
    expect(service.listReadySpeechProviders().map((item) => item.id)).toContain('custom-speech-1');
    await service.testProvider('custom-speech-1');
    expect(lastRequest()).toMatchObject({
      url: 'http://127.0.0.1:8880/v1/models',
      auth: 'Bearer tts-key',
    });
    expect(service.getSpeechProvider('custom-speech-1')).toBeTruthy();
    expect(() => service.getVideoProvider('custom-speech-1')).toThrow('不是视频服务');

    // 删除后同 id 不可用，内置 Key 不受影响
    service.removeCustomProvider('custom-video-1');
    expect(() => service.getVideoProvider('custom-video-1')).toThrow('未知的 AI 服务');
    expect(credentials.get('seedance-video')).toBe('ark-builtin');
  });

  it('清除 AI 设置：逐个删除自己添加的服务（文本与媒体）后没有残留 Key', () => {
    service.addCustomProvider({
      kind: 'text',
      label: 'T',
      baseUrl: 'https://t.test',
      apiKey: 'k1',
    });
    service.addCustomProvider({ kind: 'video', vendor: 'minimax-video', label: 'V', apiKey: 'k2' });
    service.addCustomProvider({ kind: 'image', vendor: 'grok-image', label: 'I', apiKey: 'k3' });
    service.addCustomProvider({
      kind: 'speech',
      vendor: 'minimax-speech',
      label: 'S',
      apiKey: 'k4',
    });
    // 与渲染进程 clearCustomTextProviders 相同：列表里 custom 的逐个删除
    for (const item of service.listProviders().filter((entry) => entry.custom)) {
      service.removeCustomProvider(item.id);
    }
    expect(service.listProviders().some((item) => item.custom)).toBe(false);
    expect(configs.listCustomMedia()).toEqual([]);
    expect(configs.listCustomText()).toEqual([]);
    const cred = readFileSync(path.join(dir, 'cred.json'), 'utf-8');
    for (const id of ['custom-text-1', 'custom-video-1', 'custom-image-1', 'custom-speech-1']) {
      expect(cred).not.toContain(id);
    }
  });
});

describe('文本服务的生成参数', () => {
  it('每个文本服务的列表信息都带温度 / 上下文长度 / 单次回复长度；内置来自设置 JSON', () => {
    service.updateProvider('grok', { temperature: 0.3, contextTokens: 256000, maxTokens: 2048 });
    service.addCustomProvider({ label: 'K', baseUrl: 'https://k.test/v1' });
    service.updateProvider('custom-text-1', { temperature: 0.9 });
    const byId = Object.fromEntries(service.listProviders().map((item) => [item.id, item]));
    expect(byId['openai-compatible']).toMatchObject({
      temperature: 1.1,
      maxTokens: 4096,
      contextTokens: 64000,
    });
    expect(byId.grok).toMatchObject({ temperature: 0.3, contextTokens: 256000, maxTokens: 2048 });
    expect(byId['custom-text-1'].temperature).toBe(0.9);
    // 持久化在 ai-providers.json；null 恢复默认
    expect(newService().getProviderInfo('grok').temperature).toBe(0.3);
    expect(service.updateProvider('grok', { temperature: null }).temperature).toBeUndefined();
    expect(() => service.updateProvider('grok', { temperature: 3 })).toThrow('温度');
    expect(() => service.updateProvider('grok', { contextTokens: 10 })).toThrow('上下文长度');
    // 媒体服务没有这组参数
    expect(service.getProviderInfo('seedance-video').temperature).toBeUndefined();
  });

  it('请求使用服务的温度；单次回复长度是请求 max_tokens 的上限', async () => {
    credentials.set('grok', 'xai-1');
    service.updateProvider('grok', {
      baseUrl: 'https://grok.test/v1',
      temperature: 0.25,
      maxTokens: 300,
    });
    await service.complete({ providerId: 'grok', prompt: 'hi' });
    expect(lastRequest().body).toMatchObject({ temperature: 0.25, max_tokens: 300 });
    // 功能自带温度时以功能为准；请求长度超过上限时被夹住
    await service.complete({ providerId: 'grok', prompt: 'hi', temperature: 0.9, maxTokens: 900 });
    expect(lastRequest().body).toMatchObject({ temperature: 0.9, max_tokens: 300 });
    await service.complete({ providerId: 'grok', prompt: 'hi', maxTokens: 100 });
    expect(lastRequest().body).toMatchObject({ max_tokens: 100 });

    // 内置默认：参数来自设置 JSON，同样是上限
    credentials.set('openai-compatible', 'sk-1');
    await service.complete({ prompt: 'hi', maxTokens: 8192 });
    expect(lastRequest().url).toBe('https://builtin.test/v1/chat/completions');
    expect(lastRequest().body).toMatchObject({ temperature: 1.1, max_tokens: 4096 });
  });
});
