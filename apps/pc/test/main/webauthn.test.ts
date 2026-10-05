import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SelectHandler = (
  event: { preventDefault: () => void },
  details: {
    relyingPartyId?: string;
    accounts?: Array<{
      credentialId: string;
      name?: string;
      displayName?: string;
      userName?: string;
    }>;
  },
  callback: (credentialId?: string | null) => void
) => Promise<void>;

const mocks = vi.hoisted(() => ({
  configureWebAuthn: vi.fn(),
  showMessageBox: vi.fn(),
  sessionOn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { configureWebAuthn: mocks.configureWebAuthn },
  dialog: { showMessageBox: mocks.showMessageBox },
  session: { defaultSession: { on: mocks.sessionOn } },
}));

type WebAuthnModule = typeof import('../../src/main/webauthn');

async function loadModule(): Promise<WebAuthnModule> {
  vi.resetModules();
  return import('../../src/main/webauthn');
}

const originalPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const ENV_KEYS = [
  'NOVEL_EDITOR_WEBAUTHN_KEYCHAIN_ACCESS_GROUP',
  'NOVEL_EDITOR_APPLE_TEAM_ID',
  'APPLE_TEAM_ID',
  'CSC_TEAM_ID',
];

describe('webauthn', () => {
  beforeEach(() => {
    mocks.configureWebAuthn.mockReset();
    mocks.showMessageBox.mockReset();
    mocks.sessionOn.mockReset();
    for (const key of ENV_KEYS) vi.stubEnv(key, '');
    setPlatform('darwin');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.unstubAllEnvs();
  });

  describe('configureWebAuthn', () => {
    it('非 macOS 平台直接返回支持信息，不配置 Touch ID', async () => {
      setPlatform('linux');
      const { configureWebAuthn } = await loadModule();
      expect(configureWebAuthn()).toEqual({
        platform: 'linux',
        standardApiAvailable: true,
        roamingAuthenticatorSupported: true,
        touchIdConfigured: false,
        touchIdAvailable: false,
        keychainAccessGroup: null,
        configurationError: null,
      });
      expect(mocks.configureWebAuthn).not.toHaveBeenCalled();
    });

    it('缺少 team id 时记录配置错误', async () => {
      const { configureWebAuthn } = await loadModule();
      const info = configureWebAuthn();
      expect(info.configurationError).toMatch(/APPLE_TEAM_ID/);
      expect(info.touchIdAvailable).toBe(false);
      expect(mocks.configureWebAuthn).not.toHaveBeenCalled();
    });

    it('优先使用显式 keychain access group', async () => {
      vi.stubEnv('NOVEL_EDITOR_WEBAUTHN_KEYCHAIN_ACCESS_GROUP', '  EXPLICIT.group ');
      vi.stubEnv('APPLE_TEAM_ID', 'TEAM');
      const { configureWebAuthn } = await loadModule();
      const info = configureWebAuthn();
      expect(mocks.configureWebAuthn).toHaveBeenCalledWith({
        touchID: { keychainAccessGroup: 'EXPLICIT.group', promptReason: 'sign in to $1' },
      });
      expect(info).toMatchObject({
        touchIdConfigured: true,
        touchIdAvailable: true,
        keychainAccessGroup: 'EXPLICIT.group',
        configurationError: null,
      });
    });

    it('按优先级从 team id 环境变量推导，并去掉末尾的点', async () => {
      vi.stubEnv('APPLE_TEAM_ID', 'APPLE.');
      vi.stubEnv('CSC_TEAM_ID', 'CSC');
      const { configureWebAuthn } = await loadModule();
      expect(configureWebAuthn().keychainAccessGroup).toBe('APPLE.com.novel-editor.app.webauthn');
    });

    it('NOVEL_EDITOR_APPLE_TEAM_ID 优先于其它变量；空白值被跳过', async () => {
      vi.stubEnv('NOVEL_EDITOR_APPLE_TEAM_ID', 'NE');
      vi.stubEnv('APPLE_TEAM_ID', 'APPLE');
      let mod = await loadModule();
      expect(mod.configureWebAuthn().keychainAccessGroup).toBe('NE.com.novel-editor.app.webauthn');

      vi.stubEnv('NOVEL_EDITOR_APPLE_TEAM_ID', '   ');
      vi.stubEnv('APPLE_TEAM_ID', '');
      vi.stubEnv('CSC_TEAM_ID', 'CSC');
      mod = await loadModule();
      expect(mod.configureWebAuthn().keychainAccessGroup).toBe('CSC.com.novel-editor.app.webauthn');
    });

    it('app.configureWebAuthn 抛错时记录错误信息', async () => {
      vi.stubEnv('APPLE_TEAM_ID', 'T');
      mocks.configureWebAuthn.mockImplementation(() => {
        throw new Error('not signed');
      });
      const { configureWebAuthn } = await loadModule();
      const info = configureWebAuthn();
      expect(info.configurationError).toBe('not signed');
      expect(info.touchIdConfigured).toBe(false);
      expect(info.keychainAccessGroup).toBeNull();
    });

    it('非 Error 抛出值被字符串化', async () => {
      vi.stubEnv('APPLE_TEAM_ID', 'T');
      mocks.configureWebAuthn.mockImplementation(() => {
        throw 'boom';
      });
      const { configureWebAuthn } = await loadModule();
      expect(configureWebAuthn().configurationError).toBe('boom');
    });

    it('已配置或已失败时不重复配置', async () => {
      vi.stubEnv('APPLE_TEAM_ID', 'T');
      const { configureWebAuthn, getWebAuthnSupportInfo } = await loadModule();
      configureWebAuthn();
      configureWebAuthn();
      expect(mocks.configureWebAuthn).toHaveBeenCalledTimes(1);
      expect(getWebAuthnSupportInfo().touchIdConfigured).toBe(true);

      vi.stubEnv('APPLE_TEAM_ID', '');
      const failing = await loadModule();
      failing.configureWebAuthn();
      vi.stubEnv('APPLE_TEAM_ID', 'T');
      failing.configureWebAuthn();
      expect(mocks.configureWebAuthn).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerWebAuthnSessionHandlers', () => {
    async function getHandler(): Promise<SelectHandler> {
      const { registerWebAuthnSessionHandlers } = await loadModule();
      registerWebAuthnSessionHandlers();
      expect(mocks.sessionOn).toHaveBeenCalledWith('select-webauthn-account', expect.any(Function));
      return mocks.sessionOn.mock.calls[0][1] as SelectHandler;
    }

    function invoke(handler: SelectHandler, details: Parameters<SelectHandler>[1]) {
      const preventDefault = vi.fn();
      const callback = vi.fn();
      return handler({ preventDefault }, details, callback).then(() => ({
        preventDefault,
        callback,
      }));
    }

    it('无账户时回调 null', async () => {
      const handler = await getHandler();
      const { preventDefault, callback } = await invoke(handler, { relyingPartyId: 'x.com' });
      expect(preventDefault).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null);
      expect(mocks.showMessageBox).not.toHaveBeenCalled();
    });

    it('只有一个账户时直接选中', async () => {
      const handler = await getHandler();
      const { callback } = await invoke(handler, {
        relyingPartyId: 'x.com',
        accounts: [{ credentialId: 'only' }],
      });
      expect(callback).toHaveBeenCalledWith('only');
      expect(mocks.showMessageBox).not.toHaveBeenCalled();
    });

    it('多个账户时弹窗选择，按显示名优先级生成标签', async () => {
      mocks.showMessageBox.mockResolvedValue({ response: 1 });
      const handler = await getHandler();
      const { callback } = await invoke(handler, {
        accounts: [
          { credentialId: 'c1', displayName: '显示名', name: 'n1' },
          { credentialId: 'c2', name: 'n2', userName: 'u2' },
          { credentialId: 'c3', userName: 'u3' },
          { credentialId: 'c4' },
          { credentialId: '' },
        ],
      });
      expect(callback).toHaveBeenCalledWith('c2');
      const options = mocks.showMessageBox.mock.calls[0][0] as {
        buttons: string[];
        cancelId: number;
        message: string;
      };
      expect(options.buttons).toEqual(['显示名', 'n2', 'u3', 'c4', '未知账户', '取消']);
      expect(options.cancelId).toBe(5);
      expect(options.message).toContain('当前站点');
    });

    it('点击取消时回调 null', async () => {
      mocks.showMessageBox.mockResolvedValue({ response: 2 });
      const handler = await getHandler();
      const { callback } = await invoke(handler, {
        relyingPartyId: 'rp',
        accounts: [{ credentialId: 'a' }, { credentialId: 'b' }],
      });
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('弹窗异常时回调 null 并告警', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mocks.showMessageBox.mockRejectedValue(new Error('dialog failed'));
      const handler = await getHandler();
      const { callback } = await invoke(handler, {
        relyingPartyId: 'rp',
        accounts: [{ credentialId: 'a' }, { credentialId: 'b' }],
      });
      expect(callback).toHaveBeenCalledWith(null);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
