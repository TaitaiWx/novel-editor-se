import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SafeStorageLike } from '../../../src/main/ai/credential-store';
import { normalizeProfileLabel, ProviderConfigStore } from '../../../src/main/ai/provider-config';
import { AIService } from '../../../src/main/ai/service';
import {
  interceptSettingsWrite,
  sanitizeSettingsForRenderer,
} from '../../../src/main/ai/settings-secrets';

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

function reply(text: string) {
  return new Response(JSON.stringify({ model: 'x', choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastRequest(): { url: string; auth: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  const headers = new Headers(init.headers);
  return {
    url,
    auth: headers.get('authorization') ?? '',
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ne-ai-custom-'));
  credentials = new CredentialStore(path.join(dir, 'cred.json'), safeStorage);
  configs = new ProviderConfigStore(path.join(dir, 'providers.json'));
  settingsJson = JSON.stringify({
    ai: {
      enabled: true,
      enabledExplicitlySet: true,
      baseUrl: 'https://builtin.test/v1',
      model: 'builtin-model',
    },
  });
  service = new AIService({
    credentials,
    configs,
    readSettings: () => settingsJson,
    clock: () => new Date('2026-01-01T00:00:00Z'),
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => reply('ok'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe('自定义文本 AI', () => {
  it('添加 / 列出 / 改名 / 删除；编号只增不减；Key 只在安全存储', () => {
    const a = service.addCustomTextProvider({
      label: ' DeepSeek ',
      baseUrl: 'https://api.deepseek.com/v1/',
      model: 'deepseek-chat',
      apiKey: 'sk-deep',
    });
    expect(a).toMatchObject({
      id: 'custom-text-1',
      kind: 'text',
      label: 'DeepSeek',
      custom: true,
      configured: true,
      enabled: true,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    const b = service.addCustomTextProvider({
      label: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
    expect(b).toMatchObject({ id: 'custom-text-2', configured: false, enabled: false });

    const list = service.listProviders();
    expect(list.filter((item) => item.custom).map((item) => item.id)).toEqual([
      'custom-text-1',
      'custom-text-2',
    ]);
    expect(JSON.stringify(list)).not.toContain('sk-deep');
    expect(readFileSync(path.join(dir, 'providers.json'), 'utf-8')).not.toContain('sk-deep');
    expect(credentials.get('custom-text-1')).toBe('sk-deep');

    expect(service.updateProvider('custom-text-1', { label: '深度求索' }).label).toBe('深度求索');
    expect(service.listProviders().find((item) => item.id === 'custom-text-1')?.label).toBe(
      '深度求索'
    );
    expect(() => service.updateProvider('grok', { label: 'x' })).toThrow('只能给自己添加的');

    expect(service.removeCustomTextProvider('custom-text-1')).toBe(true);
    expect(credentials.get('custom-text-1')).toBeNull();
    expect(configs.get('custom-text-1')).toEqual({});
    expect(service.listProviders().some((item) => item.id === 'custom-text-1')).toBe(false);
    expect(() => service.getProviderInfo('custom-text-1')).toThrow('未知的 AI 服务');
    // 删除后不复用编号：旧 Key 不会串到新服务上
    expect(service.addCustomTextProvider({ label: 'Kimi', baseUrl: 'https://k.test/v1' }).id).toBe(
      'custom-text-3'
    );
    // 另一个 AIService 实例（例如重启后）读同一份配置
    const reopened = new AIService({ credentials, configs, readSettings: () => settingsJson });
    expect(
      reopened
        .listProviders()
        .filter((item) => item.custom)
        .map((item) => item.label)
    ).toEqual(['Ollama', 'Kimi']);
  });

  it('输入校验：名称、接口地址、id、数量', () => {
    expect(() => service.addCustomTextProvider({ label: '', baseUrl: 'https://a.test' })).toThrow(
      '名称不能为空'
    );
    expect(() =>
      service.addCustomTextProvider({ label: 'x'.repeat(41), baseUrl: 'https://a.test' })
    ).toThrow('不能超过 40');
    expect(() =>
      service.addCustomTextProvider({ label: 'a\u0007b', baseUrl: 'https://a.test' })
    ).toThrow('控制字符');
    expect(() => service.addCustomTextProvider({ label: 'a', baseUrl: '' })).toThrow(
      '请填写接口地址'
    );
    expect(() => service.addCustomTextProvider({ label: 'a', baseUrl: 'file:///etc' })).toThrow(
      '只支持 http'
    );
    expect(() =>
      service.addCustomTextProvider({ label: 'a', baseUrl: 'https://u:p@a.test' })
    ).toThrow('账号密码');
    // 模型无效：不留下半成品
    expect(() =>
      service.addCustomTextProvider({ label: 'a', baseUrl: 'https://a.test', model: 'a\nb' })
    ).toThrow('模型名称无效');
    expect(configs.listCustomText()).toEqual([]);
    expect(() => service.addCustomTextProvider(null as never)).toThrow('无效的配置');
    for (const id of ['grok', 'openai-compatible', 'custom-text-', 'custom-text-1/../x', 42]) {
      expect(() => service.removeCustomTextProvider(id)).toThrow('只能删除自己添加的');
    }
    expect(service.removeCustomTextProvider('custom-text-99')).toBe(false);
    for (let index = 0; index < 20; index += 1) {
      service.addCustomTextProvider({ label: `AI ${index}`, baseUrl: 'https://a.test' });
    }
    expect(() => service.addCustomTextProvider({ label: 'x', baseUrl: 'https://a.test' })).toThrow(
      '最多添加 20 个'
    );
    expect(normalizeProfileLabel('  通义  ')).toBe('通义');
    expect(() => normalizeProfileLabel(1)).toThrow('名称无效');
  });

  it('默认写作 AI：未选择时为内置；选择后省略 providerId 的请求都走它', async () => {
    credentials.set('openai-compatible', 'sk-builtin');
    const custom = service.addCustomTextProvider({
      label: 'Qwen',
      baseUrl: 'https://qwen.test/v1',
      model: 'qwen-plus',
      apiKey: 'sk-qwen',
    });
    expect(service.resolveDefaultTextProviderId()).toBe('openai-compatible');
    expect(service.describeDefaultText()).toBeNull();
    let info = service.listProviders();
    expect(info.find((item) => item.id === 'openai-compatible')).toMatchObject({
      isDefaultText: true,
      defaultTextChosen: false,
    });
    expect(info.find((item) => item.id === custom.id)?.isDefaultText).toBeUndefined();

    await service.complete({ prompt: 'hi' });
    expect(lastRequest().url).toBe('https://builtin.test/v1/chat/completions');
    expect(lastRequest().auth).toBe('Bearer sk-builtin');

    expect(service.setDefaultTextProvider(custom.id)).toBe(custom.id);
    info = service.listProviders();
    expect(info.filter((item) => item.isDefaultText).map((item) => item.id)).toEqual([custom.id]);
    expect(info.find((item) => item.id === custom.id)?.defaultTextChosen).toBe(true);
    expect(service.describeDefaultText()).toEqual({ id: custom.id, label: 'Qwen', ready: true });

    service.updateProvider(custom.id, { temperature: 0.3, maxTokens: 512 });
    expect(await service.invokeConfiguredAI({ prompt: '灵感' })).toEqual({ ok: true, text: 'ok' });
    expect(lastRequest()).toMatchObject({
      url: 'https://qwen.test/v1/chat/completions',
      auth: 'Bearer sk-qwen',
      body: { model: 'qwen-plus', temperature: 0.3, max_tokens: 512 },
    });
    // 显式指定内置服务仍然可用（凭据隔离：用内置的 Key）
    await service.complete({ providerId: 'openai-compatible', prompt: 'x' });
    expect(lastRequest().auth).toBe('Bearer sk-builtin');

    // 总开关关闭：默认写作 AI 不再发送请求
    settingsJson = JSON.stringify({ ai: { enabled: false, enabledExplicitlySet: true } });
    expect(await service.invokeConfiguredAI({ prompt: 'x' })).toEqual({
      ok: false,
      error: 'AI 功能未启用，请先在设置中心开启',
    });
    settingsJson = JSON.stringify({ ai: { enabled: true, enabledExplicitlySet: true } });

    // 默认服务被关闭 / 没有 Key 时给出提示，并在设置摘要里标记不可用
    service.updateProvider(custom.id, { enabled: false });
    expect(service.describeDefaultText()?.ready).toBe(false);
    await expect(service.complete({ prompt: 'x' })).rejects.toThrow('Qwen 未启用');
    service.updateProvider(custom.id, { enabled: true, clearKey: true });
    await expect(service.complete({ prompt: 'x' })).rejects.toThrow('未配置 Qwen 的 API Key');

    // 不能选非文本服务 / 未知服务；传 null 恢复内置
    expect(() => service.setDefaultTextProvider('minimax-video')).toThrow('不是文本服务');
    expect(() => service.setDefaultTextProvider('nope')).toThrow('未知的 AI 服务');
    expect(service.setDefaultTextProvider(null)).toBe('openai-compatible');
    expect(service.resolveDefaultTextProviderId()).toBe('openai-compatible');

    // 删除默认写作 AI 时恢复内置
    service.setDefaultTextProvider(custom.id);
    service.removeCustomTextProvider(custom.id);
    expect(service.resolveDefaultTextProviderId()).toBe('openai-compatible');
    expect(configs.getDefaultTextProviderId()).toBeUndefined();
  });

  it('Grok 也可设为默认；配置文件里指向已不存在的服务时回退内置', () => {
    service.setDefaultTextProvider('grok');
    expect(service.resolveDefaultTextProviderId()).toBe('grok');
    service.setDefaultTextProvider('openai-compatible');
    expect(configs.getDefaultTextProviderId()).toBeUndefined();
    configs.setDefaultTextProviderId('custom-text-7');
    expect(service.resolveDefaultTextProviderId()).toBe('openai-compatible');
  });

  it('内置服务自己的开关：关闭后默认请求报「未启用」，地址仍在设置中心', async () => {
    credentials.set('openai-compatible', 'sk');
    const info = service.updateProvider('openai-compatible', {
      enabled: false,
      baseUrl: 'https://ignored.test',
    });
    expect(info.enabled).toBe(false);
    expect(configs.get('openai-compatible')).toEqual({ enabled: false });
    await expect(service.complete({ prompt: 'x' })).rejects.toThrow('OpenAI 兼容 未启用');
    service.updateProvider('openai-compatible', { enabled: true });
    expect((await service.complete({ prompt: 'x' })).text).toBe('ok');
  });

  it('配音服务的默认声音写入请求', async () => {
    credentials.set('openai-speech', 'sk-tts');
    service.updateProvider('openai-speech', { voice: 'coral' });
    expect(service.getProviderInfo('openai-speech').voice).toBe('coral');
    fetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
    );
    await service
      .getSpeechProvider('openai-speech')
      .synthesize({ text: '你好', language: 'zh-CN' });
    expect(lastRequest().body.voice).toBe('coral');
    expect(() => service.updateProvider('openai-speech', { voice: 'a\nb' })).toThrow(
      '声音名称无效'
    );
    expect(() => service.updateProvider('grok', { temperature: 3 })).toThrow('温度需在');
  });
});

describe('迁移与设置注入', () => {
  it('旧版 ai-providers.json（没有 customText / 默认）照常读取，默认仍为内置', () => {
    writeFileSync(
      path.join(dir, 'providers.json'),
      JSON.stringify({ schemaVersion: 1, providers: { grok: { model: 'grok-3' } }, video: {} })
    );
    credentials.set('openai-compatible', 'sk-old');
    expect(configs.listCustomText()).toEqual([]);
    expect(service.resolveDefaultTextProviderId()).toBe('openai-compatible');
    expect(service.getProviderInfo('grok').model).toBe('grok-3');
    expect(service.getProviderInfo('openai-compatible')).toMatchObject({
      configured: true,
      enabled: true,
      isDefaultText: true,
      baseUrl: 'https://builtin.test/v1',
    });
    // 新增自定义服务不改动旧数据
    service.addCustomTextProvider({ label: 'A', baseUrl: 'https://a.test' });
    const file = JSON.parse(readFileSync(path.join(dir, 'providers.json'), 'utf-8')) as {
      providers: Record<string, unknown>;
    };
    expect(file.providers.grok).toEqual({ model: 'grok-3' });
    expect(credentials.get('openai-compatible')).toBe('sk-old');
  });

  it('损坏的 customText 条目被忽略', () => {
    writeFileSync(
      path.join(dir, 'providers.json'),
      JSON.stringify({
        schemaVersion: 1,
        providers: {},
        video: {},
        customText: [
          { id: 'custom-text-4', label: 'OK' },
          { id: '../etc', label: 'bad' },
          { id: 'custom-text-4', label: 'dup' },
          { id: 'custom-text-5', label: '' },
          'x',
        ],
        nextCustomTextNumber: 2,
      })
    );
    expect(configs.listCustomText().map((item) => item.label)).toEqual(['OK']);
    expect(service.addCustomTextProvider({ label: 'B', baseUrl: 'https://b.test' }).id).toBe(
      'custom-text-5'
    );
  });

  it('设置 JSON：注入默认写作 AI 摘要，写回时丢弃派生字段', () => {
    const raw = JSON.stringify({ ai: { enabled: true, apiKey: 'sk-x', baseUrl: 'b' } });
    const sanitized = JSON.parse(
      sanitizeSettingsForRenderer(raw, true, { id: 'custom-text-1', label: 'Q', ready: true }) ??
        '{}'
    ) as { ai: Record<string, unknown> };
    expect(sanitized.ai).toMatchObject({
      hasApiKey: true,
      defaultTextProviderId: 'custom-text-1',
      defaultTextLabel: 'Q',
      defaultTextReady: true,
    });
    expect(sanitized.ai.apiKey).toBeUndefined();
    const plain = JSON.parse(sanitizeSettingsForRenderer(raw, false, null) ?? '{}') as {
      ai: Record<string, unknown>;
    };
    expect(plain.ai.defaultTextProviderId).toBeUndefined();

    const sink = { get: () => null, set: vi.fn(), has: () => false };
    const written = JSON.parse(interceptSettingsWrite(JSON.stringify(sanitized), sink)) as {
      ai: Record<string, unknown>;
    };
    for (const field of [
      'hasApiKey',
      'defaultTextProviderId',
      'defaultTextLabel',
      'defaultTextReady',
    ]) {
      expect(written.ai[field]).toBeUndefined();
    }
    expect(written.ai.baseUrl).toBe('b');
  });
});
