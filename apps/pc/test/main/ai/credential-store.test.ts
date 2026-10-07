import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertProviderId,
  CredentialStore,
  type SafeStorageLike,
} from '../../../src/main/ai/credential-store';
import {
  interceptSettingsWrite,
  migratePlaintextApiKey,
  sanitizeSettingsForRenderer,
  SETTINGS_CENTER_KEY,
} from '../../../src/main/ai/settings-secrets';

/** 模拟 safeStorage：可逆的「加密」（反转 + 前缀），便于断言文件中没有明文 */
function fakeSafeStorage(options: { available?: boolean; backend?: string } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    encryptString: (text) => Buffer.from(`enc:${[...text].reverse().join('')}`, 'utf-8'),
    decryptString: (buffer) => {
      const value = buffer.toString('utf-8');
      if (!value.startsWith('enc:')) throw new Error('bad cipher');
      return [...value.slice(4)].reverse().join('');
    },
    ...(options.backend ? { getSelectedStorageBackend: () => options.backend as string } : {}),
  };
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ne-cred-'));
  file = path.join(dir, 'ai-credentials.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CredentialStore', () => {
  it('加密保存、读取、列出与删除；文件中没有明文', () => {
    const store = new CredentialStore(
      file,
      fakeSafeStorage(),
      () => new Date('2026-01-01T00:00:00Z')
    );
    expect(store.isSecure()).toBe(true);
    expect(store.get('grok')).toBeNull();
    store.set('grok', '  xai-secret  ');
    expect(store.get('grok')).toBe('xai-secret');
    expect(store.has('grok')).toBe(true);
    const raw = readFileSync(file, 'utf-8');
    expect(raw).not.toContain('xai-secret');
    expect(JSON.parse(raw).entries.grok).toMatchObject({
      encrypted: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(store.list()).toEqual([
      { providerId: 'grok', encrypted: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.delete('grok')).toBe(true);
    expect(store.delete('grok')).toBe(false);
    expect(store.get('grok')).toBeNull();
  });

  it('系统不支持加密（或 Linux basic_text）时以受限权限文件保存并标记不安全', () => {
    for (const storage of [
      fakeSafeStorage({ available: false }),
      fakeSafeStorage({ backend: 'basic_text' }),
    ]) {
      const store = new CredentialStore(file, storage);
      expect(store.isSecure()).toBe(false);
      store.set('minimax-video', 'mm-key');
      expect(store.get('minimax-video')).toBe('mm-key');
      expect(store.list()[0].encrypted).toBe(false);
    }
    const throwing: SafeStorageLike = {
      ...fakeSafeStorage(),
      isEncryptionAvailable: () => {
        throw new Error('app not ready');
      },
    };
    expect(new CredentialStore(file, throwing).isSecure()).toBe(false);
  });

  it('无法解密（钥匙串被重置）或文件损坏时视为未配置', () => {
    const store = new CredentialStore(file, fakeSafeStorage());
    store.set('grok', 'k');
    const content = JSON.parse(readFileSync(file, 'utf-8'));
    content.entries.grok.data = Buffer.from('garbage').toString('base64');
    writeFileSync(file, JSON.stringify(content));
    expect(store.get('grok')).toBeNull();
    writeFileSync(file, '{not json');
    expect(store.get('grok')).toBeNull();
    store.set('grok', 'again');
    expect(store.get('grok')).toBe('again');
  });

  it('校验 Provider id 与 Key', () => {
    const store = new CredentialStore(file, fakeSafeStorage());
    expect(() => store.set('../evil', 'k')).toThrow('无效的 AI 服务 id');
    expect(() => assertProviderId(42)).toThrow();
    expect(() => store.set('grok', '   ')).toThrow('不能为空');
    expect(() => store.set('grok', 'x'.repeat(5000))).toThrow('过长');
  });
});

function memorySettings(initial?: unknown) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(SETTINGS_CENTER_KEY, JSON.stringify(initial));
  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: string) => void map.set(key, value),
    json: () => JSON.parse(map.get(SETTINGS_CENTER_KEY) ?? 'null'),
  };
}

describe('明文 Key 迁移', () => {
  it('嵌套格式：Key 移入安全存储并删除明文，固化「已启用」推断', () => {
    const store = new CredentialStore(file, fakeSafeStorage());
    const settings = memorySettings({
      general: { showStatusBar: true },
      ai: { apiKey: 'sk-old', baseUrl: 'https://a/v1', enabled: false },
    });
    expect(migratePlaintextApiKey(settings, store)).toEqual({ migrated: true, conflict: false });
    expect(store.get('openai-compatible')).toBe('sk-old');
    const after = settings.json();
    expect(after.ai.apiKey).toBeUndefined();
    // 旧数据没有显式开关 + 有 Key ⇒ 视为已启用
    expect(after.ai).toMatchObject({
      enabled: true,
      enabledExplicitlySet: true,
      baseUrl: 'https://a/v1',
    });
    expect(after.general).toEqual({ showStatusBar: true });
    // 幂等：再次迁移不做任何事
    expect(migratePlaintextApiKey(settings, store)).toEqual({ migrated: false, conflict: false });
  });

  it('旧版顶层格式与显式关闭', () => {
    const store = new CredentialStore(file, fakeSafeStorage());
    const settings = memorySettings({
      apiKey: 'sk-legacy',
      enabled: false,
      enabledExplicitlySet: true,
      model: 'm',
    });
    migratePlaintextApiKey(settings, store);
    expect(store.get('openai-compatible')).toBe('sk-legacy');
    const after = settings.json();
    expect(after.apiKey).toBeUndefined();
    expect(after).toMatchObject({
      enabled: false,
      enabledExplicitlySet: true,
      ai: { enabled: false },
    });
  });

  it('安全存储已有不同的 Key：以安全存储为准，明文仍被删除', () => {
    const store = new CredentialStore(file, fakeSafeStorage());
    store.set('openai-compatible', 'sk-new');
    const settings = memorySettings({
      ai: { apiKey: 'sk-other', enabled: true, enabledExplicitlySet: true },
    });
    expect(migratePlaintextApiKey(settings, store)).toEqual({ migrated: true, conflict: true });
    expect(store.get('openai-compatible')).toBe('sk-new');
    expect(settings.json().ai.apiKey).toBeUndefined();
  });

  it('空 Key 字段只被删除；没有设置或无法解析时不改动', () => {
    const store = new CredentialStore(file, fakeSafeStorage());
    const settings = memorySettings({ ai: { apiKey: '  ', enabled: false } });
    expect(migratePlaintextApiKey(settings, store)).toEqual({ migrated: false, conflict: false });
    expect(settings.json().ai).toEqual({ enabled: false });
    expect(store.has('openai-compatible')).toBe(false);
    expect(migratePlaintextApiKey(memorySettings(), store).migrated).toBe(false);
    const broken = { get: () => '{oops', set: () => undefined };
    expect(migratePlaintextApiKey(broken, store).migrated).toBe(false);
  });
});

describe('设置读写拦截', () => {
  it('读取：去掉 Key 并注入 hasApiKey；非 JSON 原样返回', () => {
    const out = JSON.parse(
      sanitizeSettingsForRenderer(
        JSON.stringify({ apiKey: 'x', ai: { apiKey: 'y', model: 'm' } }),
        true
      ) as string
    );
    expect(out).toEqual({ ai: { model: 'm', hasApiKey: true } });
    expect(sanitizeSettingsForRenderer(undefined, false)).toBeUndefined();
    expect(sanitizeSettingsForRenderer('nope', false)).toBe('nope');
    expect(JSON.parse(sanitizeSettingsForRenderer('{}', false) as string)).toEqual({
      ai: { hasApiKey: false },
    });
  });

  it('写入：Key 转存到安全存储，去掉 hasApiKey 派生字段', () => {
    const store = new CredentialStore(file, fakeSafeStorage());
    const stored = interceptSettingsWrite(
      JSON.stringify({ ai: { apiKey: 'sk-typed', hasApiKey: true, model: 'm' } }),
      store
    );
    expect(JSON.parse(stored)).toEqual({ ai: { model: 'm' } });
    expect(store.get('openai-compatible')).toBe('sk-typed');
    // 空 Key 不会清除已保存的 Key
    interceptSettingsWrite(JSON.stringify({ ai: { apiKey: '' } }), store);
    expect(store.get('openai-compatible')).toBe('sk-typed');
    expect(interceptSettingsWrite('raw', store)).toBe('raw');
  });
});
