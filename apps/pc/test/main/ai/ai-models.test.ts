import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SafeStorageLike } from '../../../src/main/ai/credential-store';
import { migrateLegacyConfig } from '../../../src/main/ai/model-migration';
import { ProviderConfigStore } from '../../../src/main/ai/provider-config';
import { AIService } from '../../../src/main/ai/service';
import { MAX_MODELS_PER_CAPABILITY } from '../../../src/shared/ai-models';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${text}`),
  decryptString: (buffer) => buffer.toString().slice(4),
};

let dir: string;
let providersFile: string;
let settingsJson: string | undefined;
let credentials: CredentialStore;
const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeService() {
  const configs = new ProviderConfigStore(providersFile, {
    hasCredential: (id) => credentials.has(id),
  });
  return {
    configs,
    service: new AIService({ credentials, configs, readSettings: () => settingsJson }),
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ne-ai-models-'));
  providersFile = path.join(dir, 'ai-providers.json');
  credentials = new CredentialStore(path.join(dir, 'ai-credentials.json'), safeStorage);
  settingsJson = undefined;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

/** 旧版（schemaVersion 1）的 ai-providers.json：内置服务 + 自定义文本 / 媒体 + 选定的默认写作 AI */
const LEGACY_FILE = {
  schemaVersion: 1,
  providers: {
    'openai-compatible': { enabled: true },
    grok: { model: 'grok-3', temperature: 0.8, contextTokens: 200000 },
    'seedance-video': { pricePerSecond: 0.7, currency: 'CNY' },
    'minimax-video': { enabled: false },
    'openai-speech': { voice: 'nova' },
    'custom-text-2': {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      maxTokens: 4096,
    },
    'custom-video-1': { baseUrl: 'https://ark-2.test/api/v3', pricePerSecond: 0.3 },
    'custom-image-3': { model: 'image-01' },
  },
  video: { maxConcurrent: 3, voiceLanguage: 'en-US' },
  customText: [
    { id: 'custom-text-2', label: 'DeepSeek 工作', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: '../evil', label: 'bad' },
  ],
  nextCustomTextNumber: 3,
  defaultTextProviderId: 'custom-text-2',
  customMedia: [
    { id: 'custom-video-1', kind: 'video', vendor: 'seedance-video', label: '方舟 工作室' },
    { id: 'custom-image-3', kind: 'image', vendor: 'minimax-image', label: 'MiniMax 小号' },
    { id: 'custom-speech-1', kind: 'speech', vendor: 'unknown-vendor', label: '坏数据' },
  ],
  nextCustomMediaNumber: { video: 2, image: 4, speech: 2 },
};

describe('旧版 ai-providers.json 迁移', () => {
  it('配置过的内置服务与全部自定义服务变成模型；id / Key / 参数 / 默认不变；从没配置的不出现', () => {
    writeFileSync(providersFile, JSON.stringify(LEGACY_FILE));
    for (const id of [
      'grok',
      'seedance-video',
      'custom-text-2',
      'custom-video-1',
      'custom-image-3',
    ]) {
      credentials.set(id, `key-${id}`);
    }
    const { service } = makeService();
    const list = service.listProviders();
    expect(list.map((item) => [item.id, item.kind, item.vendor])).toEqual([
      ['grok', 'text', 'grok'],
      ['seedance-video', 'video', 'seedance-video'],
      ['openai-speech', 'speech', 'openai-speech'],
      ['custom-text-2', 'text', 'openai-compatible'],
      ['custom-video-1', 'video', 'seedance-video'],
      ['custom-image-3', 'image', 'minimax-image'],
    ]);
    // minimax-video 只关过开关、没有 Key：不出现；openai-compatible 没有 Key：不出现
    expect(list.find((item) => item.id === 'grok')).toMatchObject({
      label: 'xAI Grok · grok-3',
      model: 'grok-3',
      temperature: 0.8,
      contextTokens: 200000,
      configured: true,
      isDefault: false,
    });
    expect(list.find((item) => item.id === 'custom-text-2')).toMatchObject({
      label: 'DeepSeek 工作',
      baseUrl: 'https://api.deepseek.com/v1',
      maxTokens: 4096,
      isDefault: true,
      configured: true,
    });
    expect(list.find((item) => item.id === 'seedance-video')).toMatchObject({
      pricePerSecond: 0.7,
      supportsAudio: true,
    });
    expect(list.find((item) => item.id === 'custom-video-1')).toMatchObject({
      label: '方舟 工作室',
      baseUrl: 'https://ark-2.test/api/v3',
      pricePerSecond: 0.3,
      supportsAudio: true,
    });
    expect(list.find((item) => item.id === 'openai-speech')).toMatchObject({
      voice: 'nova',
      configured: false,
    });
    // 原文件备份；新文件是 schemaVersion 2，视频设置保留，没有任何 Key
    const backup = path.join(dir, 'ai-providers.v1.json');
    expect(JSON.parse(readFileSync(backup, 'utf-8'))).toEqual(LEGACY_FILE);
    const migrated = JSON.parse(readFileSync(providersFile, 'utf-8'));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.video).toEqual({ maxConcurrent: 3, voiceLanguage: 'en-US' });
    expect(readFileSync(providersFile, 'utf-8')).not.toContain('key-');
    // Key 仍按旧 id 使用
    expect(credentials.get('custom-video-1')).toBe('key-custom-video-1');
    // 再次读取不重复迁移
    expect(makeService().service.listProviders()).toHaveLength(6);
  });

  it('内置默认 AI：Key 在安全存储、地址 / 模型在设置 JSON；数据库打开后导入，仍是默认文本模型', () => {
    writeFileSync(
      providersFile,
      JSON.stringify({ schemaVersion: 1, providers: { grok: { model: 'grok-4' } } })
    );
    credentials.set('openai-compatible', 'sk-default');
    credentials.set('grok', 'xai');
    const { service, configs } = makeService();
    // 数据库还没打开：条目已建，名称是占位
    expect(service.listProviders().map((item) => [item.id, item.label])).toEqual([
      ['openai-compatible', 'OpenAI 兼容'],
      ['grok', 'xAI Grok · grok-4'],
    ]);
    expect(configs.getDefaultId('text')).toBe('openai-compatible');
    settingsJson = JSON.stringify({
      ai: {
        enabled: true,
        enabledExplicitlySet: true,
        preset: 'deepseek-official',
        baseUrl: 'https://api.deepseek.com/v1/',
        model: 'deepseek-chat',
        temperature: 1.1,
        maxTokens: 8192,
        contextTokens: 128000,
      },
    });
    const info = service.getProviderInfo('openai-compatible');
    expect(info).toMatchObject({
      label: 'DeepSeek · deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      temperature: 1.1,
      maxTokens: 8192,
      contextTokens: 128000,
      isDefault: true,
      configured: true,
    });
    // 只导入一次：设置 JSON 之后的改动不再影响条目
    settingsJson = JSON.stringify({ ai: { enabled: true, model: 'other' } });
    expect(service.getProviderInfo('openai-compatible').model).toBe('deepseek-chat');
  });

  it('明文 Key 稍后才迁入安全存储：数据库打开时补建内置默认条目并设为默认', () => {
    const { service, configs } = makeService();
    expect(service.listProviders()).toEqual([]);
    settingsJson = JSON.stringify({ ai: { baseUrl: 'https://llm.test/v1', model: 'm1' } });
    credentials.set('openai-compatible', 'sk-late');
    expect(service.listProviders()).toMatchObject([
      { id: 'openai-compatible', label: 'OpenAI 兼容 · m1', model: 'm1', isDefault: true },
    ]);
    expect(configs.getDefaultId('text')).toBe('openai-compatible');
  });

  it('损坏 / 不合法的旧数据被忽略；空文件与非对象', () => {
    expect(migrateLegacyConfig(null, { hasCredential: () => false, now: 'n' }).models).toEqual([]);
    const file = migrateLegacyConfig(
      {
        providers: { grok: { model: 42, baseUrl: '' } },
        customText: [{ id: 'custom-text-1' }, 'x', { id: 'custom-text-1', label: '重复' }],
        customMedia: [
          { id: 'custom-video-9', kind: 'image', vendor: 'seedance-video', label: 'x' },
        ],
        defaultTextProviderId: 'gone',
      },
      { hasCredential: () => false, now: 'n' }
    );
    // custom-text-1 没有名称时用 id；不一致的媒体登记丢弃；指向不存在服务的默认被忽略
    expect(file.models.map((item) => [item.id, item.label])).toEqual([
      ['custom-text-1', 'custom-text-1'],
    ]);
    expect(file.defaults).toEqual({});
    writeFileSync(providersFile, '{not json');
    expect(makeService().service.listProviders()).toEqual([]);
  });
});

describe('模型增删改与默认模型', () => {
  it('同一服务商可以添加多个模型；每个能力一个默认；默认被删后回到第一个可用的', () => {
    const { service } = makeService();
    const grok = service.addModel({
      capability: 'text',
      vendor: 'grok',
      preset: 'grok',
      model: 'grok-4',
      apiKey: 'xai',
    });
    const fast = service.addModel({
      capability: 'text',
      vendor: 'grok',
      preset: 'grok',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-4-fast',
      reuseKeyFrom: grok.id,
    });
    expect([grok.id, fast.id]).toEqual(['text-1', 'text-2']);
    expect(fast).toMatchObject({ label: 'xAI Grok · grok-4-fast', configured: true });
    expect(credentials.get('text-2')).toBe('xai');
    expect(service.resolveDefaultId('text')).toBe('text-1');
    service.setDefaultModel('text', 'text-2');
    expect(service.resolveDefaultId('text')).toBe('text-2');
    expect(service.listProviders().filter((item) => item.isDefault)).toHaveLength(1);
    // 每个能力各自的默认
    const image = service.addModel({ capability: 'image', vendor: 'seedream-image', apiKey: 'a' });
    const image2 = service.addModel({ capability: 'image', vendor: 'grok-image', apiKey: 'b' });
    expect(service.resolveDefaultId('image')).toBe(image.id);
    service.setDefaultModel('image', image2.id);
    expect(service.resolveDefaultId('image')).toBe(image2.id);
    expect(service.resolveDefaultId('text')).toBe('text-2');
    expect(service.resolveDefaultId('video')).toBeUndefined();
    // 没有 Key 的不当默认（没选定时按第一个可用的）
    service.setDefaultModel('image', null);
    service.updateModel(image.id, { clearKey: true });
    expect(service.resolveDefaultId('image')).toBe(image2.id);
    // 删除默认：回到第一个可用的；编号不复用
    expect(service.removeModel('text-2')).toBe(true);
    expect(credentials.get('text-2')).toBeNull();
    expect(service.resolveDefaultId('text')).toBe('text-1');
    expect(service.addModel({ capability: 'text', vendor: 'grok' }).id).toBe('text-3');
    expect(service.removeModel('text-404')).toBe(false);
  });

  it('校验：能力与协议、预设、地址、名称、模型、id、数量上限', () => {
    const { service } = makeService();
    const bad = (input: unknown) => () => service.addModel(input as never);
    expect(bad({ capability: 'text', vendor: 'minimax-video' })).toThrow('服务商与模型类型不一致');
    expect(bad({ capability: 'text', vendor: 'nope' })).toThrow('服务商与模型类型不一致');
    expect(bad({ capability: 'x', vendor: 'grok' })).toThrow('无效的模型类型');
    expect(bad({ capability: 'image', vendor: 'grok-image', preset: 'grok' })).toThrow('预设');
    expect(bad({ capability: 'text', vendor: 'openai-compatible' })).toThrow('请填写接口地址');
    expect(bad({ capability: 'text', vendor: 'grok', baseUrl: 'ftp://x' })).toThrow('http');
    expect(bad({ capability: 'text', vendor: 'grok', label: '名'.repeat(81) })).toThrow('80');
    expect(bad({ capability: 'text', vendor: 'grok', label: 'a\u0007b' })).toThrow('控制字符');
    expect(bad({ capability: 'text', vendor: 'grok', model: 'a\nb' })).toThrow('模型名称无效');
    expect(bad({ capability: 'text', vendor: 'grok', apiKey: 'k'.repeat(5000) })).toThrow('过长');
    expect(() => service.updateModel('Bad Id', {})).toThrow('无效的模型 id');
    expect(() => service.setDefaultModel('music', null)).toThrow('无效的模型类型');
    const added = service.addModel({ capability: 'text', vendor: 'grok' });
    expect(() => service.updateModel(added.id, { label: '' })).toThrow('名称不能为空');
    expect(() => service.updateModel(added.id, { temperature: 3 })).toThrow('温度');
    expect(() => service.updateModel(added.id, { preset: 'deepseek' })).toThrow('预设');
    // 失败不留半成品
    expect(service.listProviders()).toHaveLength(1);
    for (let i = 1; i < MAX_MODELS_PER_CAPABILITY; i += 1) {
      service.addModel({ capability: 'text', vendor: 'grok' });
    }
    expect(bad({ capability: 'text', vendor: 'grok' })).toThrow(
      `最多添加 ${MAX_MODELS_PER_CAPABILITY}`
    );
    // 其他能力不受影响
    expect(service.addModel({ capability: 'speech', vendor: 'openai-speech' }).id).toBe('speech-1');
  });

  it('沿用 Key 只在同一服务商 + 同一接口地址、且已保存 Key 时可用；列表从不包含 Key', () => {
    const { service } = makeService();
    const a = service.addModel({
      capability: 'video',
      vendor: 'seedance-video',
      apiKey: 'ark-secret',
    });
    const noKey = service.addModel({ capability: 'video', vendor: 'minimax-video' });
    const reuse = (input: Record<string, unknown>) => () =>
      service.addModel({ capability: 'video', vendor: 'seedance-video', ...input } as never);
    expect(reuse({ reuseKeyFrom: 'video-404' })).toThrow('同一服务商');
    expect(reuse({ reuseKeyFrom: noKey.id })).toThrow('同一服务商');
    expect(reuse({ reuseKeyFrom: a.id, baseUrl: 'https://other.test' })).toThrow('同一接口地址');
    const b = service.addModel({
      capability: 'video',
      vendor: 'seedance-video',
      model: 'doubao-seedance-2-0-fast-260128',
      reuseKeyFrom: a.id,
    });
    expect(credentials.get(b.id)).toBe('ark-secret');
    // 两条模型的 Key 各自独立：清除一条不影响另一条
    service.updateModel(a.id, { clearKey: true });
    expect(credentials.get(b.id)).toBe('ark-secret');
    const dump = JSON.stringify(service.listProviders());
    expect(dump).not.toContain('ark-secret');
    expect(readFileSync(providersFile, 'utf-8')).not.toContain('ark-secret');
  });

  it('按协议实例化：每条模型用自己的地址 / 模型 / Key', async () => {
    const { service } = makeService();
    const video = service.addModel({
      capability: 'video',
      vendor: 'seedance-video',
      baseUrl: 'https://ark-b.test/api/v3',
      model: 'seed-b',
      apiKey: 'ark-b',
    });
    fetchMock.mockImplementation(async () => json({ id: 'task-1' }));
    await service.getVideoProvider(video.id).submitTask({ prompt: '雪夜' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ark-b.test/api/v3/contents/generations/tasks');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ark-b');
    expect(JSON.parse(String(init.body)).model).toBe('seed-b');

    const deepseek = service.addModel({
      capability: 'text',
      vendor: 'openai-compatible',
      preset: 'deepseek',
      baseUrl: 'https://ds.test/v1',
      model: 'deepseek-reasoner',
      apiKey: 'sk-ds',
      temperature: 0.2,
    });
    fetchMock.mockImplementation(async () => json({ choices: [{ message: { content: 'ok' } }] }));
    await service.complete({ providerId: deepseek.id, prompt: 'hi' });
    const [textUrl, textInit] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(textUrl).toBe('https://ds.test/v1/chat/completions');
    expect(JSON.parse(String(textInit.body))).toMatchObject({
      model: 'deepseek-reasoner',
      temperature: 0.2,
    });

    const speech = service.addModel({
      capability: 'speech',
      vendor: 'openai-speech',
      baseUrl: 'https://tts.test/v1',
      voice: 'onyx',
      apiKey: 'tts',
    });
    expect(service.getSpeechProvider().id).toBe('openai-speech');
    expect(() => service.getImageProvider()).toThrow('还没有图片模型');
    expect(service.getProviderInfo(speech.id)).toMatchObject({ voice: 'onyx', isDefault: true });
  });

  it('总开关只约束默认文本模型', async () => {
    settingsJson = JSON.stringify({ ai: { enabled: false, enabledExplicitlySet: true } });
    const { service } = makeService();
    const a = service.addModel({ capability: 'text', vendor: 'grok', apiKey: 'k1' });
    const b = service.addModel({ capability: 'text', vendor: 'grok', apiKey: 'k2' });
    expect(() => service.getTextProvider()).toThrow('AI 功能未启用');
    expect(() => service.getTextProvider(a.id)).toThrow('AI 功能未启用');
    expect(service.getTextProvider(b.id).kind).toBe('text');
    expect(existsSync(providersFile)).toBe(true);
  });
});
