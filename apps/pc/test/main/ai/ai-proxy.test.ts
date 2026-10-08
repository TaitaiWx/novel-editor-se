import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SafeStorageLike } from '../../../src/main/ai/credential-store';
import { ProviderConfigStore } from '../../../src/main/ai/provider-config';
import {
  ProxyFetcher,
  toSessionProxyConfig,
  type ProxySession,
} from '../../../src/main/ai/proxy-fetch';
import { AIService } from '../../../src/main/ai/service';
import {
  normalizeProxySettings,
  normalizeProxyUrl,
  type AIProxySettings,
} from '../../../src/shared/ai-proxy';
import { findPreset } from '../../../src/shared/ai-models';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${text}`),
  decryptString: (buffer) => buffer.toString().slice(4),
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

describe('normalizeProxyUrl / normalizeProxySettings', () => {
  it('接受 http / https / socks4 / socks5 的 host:port，去掉末尾斜杠', () => {
    expect(normalizeProxyUrl(' http://127.0.0.1:7890/ ')).toBe('http://127.0.0.1:7890');
    expect(normalizeProxyUrl('https://proxy.local:8443')).toBe('https://proxy.local:8443');
    expect(normalizeProxyUrl('socks5://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080');
    expect(normalizeProxyUrl('socks4://10.0.0.2:1080')).toBe('socks4://10.0.0.2:1080');
    expect(normalizeProxyUrl('')).toBe('');
  });

  it('拒绝其他协议、账号密码、缺端口、带路径与非字符串', () => {
    expect(() => normalizeProxyUrl('ftp://a:21')).toThrow('只支持');
    expect(() => normalizeProxyUrl('http://u:p@127.0.0.1:7890')).toThrow('账号密码');
    expect(() => normalizeProxyUrl('http://127.0.0.1')).toThrow('端口');
    expect(() => normalizeProxyUrl('http://127.0.0.1:7890/pac')).toThrow('只填协议');
    expect(() => normalizeProxyUrl('127.0.0.1:7890')).toThrow();
    expect(() => normalizeProxyUrl(42)).toThrow('代理地址无效');
  });

  it('整份设置：缺省为跟随系统代理；严格模式拒绝无效地址，宽松模式回退', () => {
    expect(normalizeProxySettings(undefined)).toEqual({ mode: 'system' });
    expect(normalizeProxySettings({ mode: 'system', url: 'http://x:1' })).toEqual({
      mode: 'system',
    });
    expect(normalizeProxySettings({ mode: 'manual', url: 'socks5://h:1080/' })).toEqual({
      mode: 'manual',
      url: 'socks5://h:1080',
    });
    expect(() => normalizeProxySettings({ mode: 'manual', url: '' })).toThrow('请填写代理地址');
    expect(normalizeProxySettings({ mode: 'manual', url: 'bad' }, true)).toEqual({
      mode: 'system',
    });
  });
});

describe('toSessionProxyConfig', () => {
  it('手动地址 → fixed_servers，loopback 也走代理；否则跟随系统', () => {
    expect(toSessionProxyConfig({ mode: 'manual', url: 'http://127.0.0.1:7890' })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<-loopback>',
    });
    expect(toSessionProxyConfig({ mode: 'system' })).toEqual({ mode: 'system' });
    expect(toSessionProxyConfig({ mode: 'manual' })).toEqual({ mode: 'system' });
  });
});

describe('ProxyFetcher', () => {
  function fakeSession() {
    const session = {
      setProxy: vi.fn(async () => undefined),
      closeAllConnections: vi.fn(async () => undefined),
      fetch: vi.fn(async () => new Response('ok')),
    } satisfies ProxySession;
    return session;
  }

  it('第一次请求前按设置 setProxy，设置不变时不重复；变化后重新设置并断开旧连接', async () => {
    const session = fakeSession();
    const getSession = vi.fn(() => session);
    let settings: AIProxySettings = { mode: 'manual', url: 'http://127.0.0.1:7890' };
    const fetcher = new ProxyFetcher(getSession, () => settings);

    await fetcher.fetch('https://api.openai.com/v1/models', { method: 'GET' });
    await fetcher.fetch('https://api.openai.com/v1/models');
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(session.setProxy).toHaveBeenCalledTimes(1);
    expect(session.setProxy).toHaveBeenLastCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: '<-loopback>',
    });
    expect(session.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      method: 'GET',
    });

    settings = { mode: 'system' };
    await fetcher.fetch('https://api.x.ai/v1/chat/completions');
    expect(session.setProxy).toHaveBeenCalledTimes(2);
    expect(session.setProxy).toHaveBeenLastCalledWith({ mode: 'system' });
    expect(session.closeAllConnections).toHaveBeenCalledTimes(2);
  });

  it('并发请求等待同一次 setProxy 完成后再发出', async () => {
    const session = fakeSession();
    let release: () => void = () => undefined;
    session.setProxy.mockImplementation(
      () => new Promise<undefined>((resolve) => (release = () => resolve(undefined)))
    );
    const fetcher = new ProxyFetcher(
      () => session,
      () => ({ mode: 'system' })
    );
    const first = fetcher.fetch('https://a.test/1');
    const second = fetcher.fetch('https://a.test/2');
    await Promise.resolve();
    expect(session.fetch).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(session.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('模型的「通过代理访问」', () => {
  let dir: string;
  let credentials: CredentialStore;
  let configs: ProviderConfigStore;
  const directFetch = vi.fn(async () => json({ choices: [] }));
  const proxyFetch = vi.fn(async () => json({ choices: [] }));

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ne-ai-proxy-'));
    credentials = new CredentialStore(path.join(dir, 'cred.json'), safeStorage);
    configs = new ProviderConfigStore(path.join(dir, 'providers.json'));
    directFetch.mockClear();
    proxyFetch.mockClear();
    vi.stubGlobal('fetch', directFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  const makeService = (withProxy = true) =>
    new AIService({
      credentials,
      configs,
      readSettings: () => JSON.stringify({ ai: { enabled: true, enabledExplicitlySet: true } }),
      ...(withProxy ? { proxyFetch } : {}),
    });

  it('添加时可勾选，列表返回 useProxy；编辑可开关，文件里只在开启时记录', () => {
    const service = makeService();
    const proxied = service.addModel({
      capability: 'text',
      vendor: 'grok',
      apiKey: 'xai',
      useProxy: true,
    });
    const direct = service.addModel({ capability: 'text', vendor: 'grok', apiKey: 'xai2' });
    expect(proxied.useProxy).toBe(true);
    expect(direct.useProxy).toBe(false);
    const file = JSON.parse(readFileSync(path.join(dir, 'providers.json'), 'utf-8')) as {
      models: Array<{ id: string; useProxy?: boolean }>;
    };
    expect(file.models.find((item) => item.id === proxied.id)?.useProxy).toBe(true);
    expect(file.models.find((item) => item.id === direct.id)).not.toHaveProperty('useProxy');

    expect(service.updateModel(proxied.id, { useProxy: false }).useProxy).toBe(false);
    expect(service.updateModel(direct.id, { useProxy: true }).useProxy).toBe(true);
    // 非布尔值忽略
    expect(service.updateModel(direct.id, { useProxy: 'yes' as unknown as boolean }).useProxy).toBe(
      true
    );
  });

  it('勾选了代理的模型（请求 / 测试连接 / 成片下载）走代理 fetch，其余直连', async () => {
    const service = makeService();
    const proxied = service.addModel({
      capability: 'text',
      vendor: 'grok',
      apiKey: 'xai',
      useProxy: true,
    });
    const direct = service.addModel({ capability: 'text', vendor: 'grok', apiKey: 'xai2' });

    await service.testProvider(proxied.id);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(directFetch).not.toHaveBeenCalled();
    expect(proxyFetch.mock.calls[0][0]).toBe('https://api.x.ai/v1/chat/completions');

    await service.complete({ providerId: proxied.id, prompt: '你好' });
    expect(proxyFetch).toHaveBeenCalledTimes(2);

    await service.testProvider(direct.id);
    await service.complete({ providerId: direct.id, prompt: '你好' });
    expect(directFetch).toHaveBeenCalledTimes(2);
    expect(proxyFetch).toHaveBeenCalledTimes(2);

    expect(service.fetchFor(proxied.id)).toBe(proxyFetch);
    expect(service.fetchFor(direct.id)).toBeUndefined();
    expect(service.fetchFor('missing-1')).toBeUndefined();
  });

  it('没有提供代理通道时（例如单测 / CLI）勾选了也直连', async () => {
    const service = makeService(false);
    const proxied = service.addModel({
      capability: 'text',
      vendor: 'grok',
      apiKey: 'xai',
      useProxy: true,
    });
    await service.testProvider(proxied.id);
    expect(directFetch).toHaveBeenCalledTimes(1);
  });

  it('代理设置保存在 ai-providers.json：默认跟随系统，严格校验，损坏时回退', () => {
    const service = makeService();
    expect(service.getProxySettings()).toEqual({ mode: 'system' });
    expect(service.setProxySettings({ mode: 'manual', url: 'socks5://127.0.0.1:1080/' })).toEqual({
      mode: 'manual',
      url: 'socks5://127.0.0.1:1080',
    });
    expect(configs.getProxy()).toEqual({ mode: 'manual', url: 'socks5://127.0.0.1:1080' });
    expect(() => service.setProxySettings({ mode: 'manual', url: 'http://u:p@h:1' })).toThrow(
      '账号密码'
    );
    expect(configs.getProxy().url).toBe('socks5://127.0.0.1:1080');

    const file = path.join(dir, 'providers.json');
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...raw, proxy: { mode: 'manual', url: 'nope' } }));
    expect(configs.getProxy()).toEqual({ mode: 'system' });
  });

  it('境外服务商预设默认建议代理，国内服务商不建议', () => {
    for (const key of ['openai', 'grok', 'grok-image', 'openai-image', 'openai-speech']) {
      expect(findPreset(key)?.suggestProxy, key).toBe(true);
    }
    for (const key of ['deepseek', 'qwen', 'kimi', 'glm', 'ollama', 'seedream', 'seedance']) {
      expect(findPreset(key)?.suggestProxy, key).toBeFalsy();
    }
  });
});
