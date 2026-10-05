// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPasskeyCredential,
  getPasskeyAssertion,
  getPasskeyCapability,
} from '@/render/utils/webauthn';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const toB64Url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

type WindowWithElectron = Window & { electron?: unknown };

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

function setCredentials(credentials: Partial<CredentialsContainer> | undefined) {
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
}

describe('getPasskeyCapability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as WindowWithElectron).electron;
    setCredentials(undefined);
  });

  it('WebAuthn 与平台认证器可用且安全上下文时 ready', async () => {
    setSecureContext(true);
    setCredentials({});
    const pkc = { isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true) };
    vi.stubGlobal('PublicKeyCredential', pkc);
    Object.defineProperty(window, 'PublicKeyCredential', { value: pkc, configurable: true });
    const support = { platform: 'darwin', touchIdAvailable: true };
    (window as WindowWithElectron).electron = {
      ipcRenderer: { invoke: vi.fn().mockResolvedValue(support) },
    };

    const capability = await getPasskeyCapability();
    expect(capability).toEqual({
      secureContext: true,
      webAuthnApiAvailable: true,
      platformAuthenticatorAvailable: true,
      electron: support,
      readyForPlatformPasskey: true,
    });
  });

  it('IPC 失败与平台检测失败时降级', async () => {
    setSecureContext(true);
    setCredentials({});
    const pkc = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockRejectedValue(new Error('x')),
    };
    vi.stubGlobal('PublicKeyCredential', pkc);
    Object.defineProperty(window, 'PublicKeyCredential', { value: pkc, configurable: true });
    (window as WindowWithElectron).electron = {
      ipcRenderer: { invoke: vi.fn().mockRejectedValue(new Error('no handler')) },
    };
    const capability = await getPasskeyCapability();
    expect(capability.electron).toBeNull();
    expect(capability.platformAuthenticatorAvailable).toBe(false);
    expect(capability.readyForPlatformPasskey).toBe(false);
  });

  it('没有 WebAuthn API 与 electron 桥时全部不可用', async () => {
    setSecureContext(false);
    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
    const capability = await getPasskeyCapability();
    expect(capability).toMatchObject({
      secureContext: false,
      webAuthnApiAvailable: false,
      platformAuthenticatorAvailable: false,
      electron: null,
    });
  });
});

describe('createPasskeyCredential / getPasskeyAssertion', () => {
  const create = vi.fn();
  const get = vi.fn();

  beforeEach(() => {
    create.mockReset();
    get.mockReset();
    setCredentials({ create, get } as unknown as CredentialsContainer);
  });
  afterEach(() => {
    setCredentials(undefined);
  });

  it('注册时把 base64url 选项转成 ArrayBuffer 并序列化响应', async () => {
    create.mockResolvedValue({
      id: 'cred-1',
      type: 'public-key',
      rawId: bytes(251, 255),
      response: {
        clientDataJSON: bytes(1, 2, 3),
        attestationObject: bytes(4, 5),
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
    });

    const result = await createPasskeyCredential({
      challenge: toB64Url(bytes(9, 8, 7)),
      rp: { name: '小说编辑器' },
      user: { id: toB64Url(bytes(1)), name: 'linmo', displayName: '林墨' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: toB64Url(bytes(250, 251)), type: 'public-key' }],
    });

    const options = create.mock.calls[0][0] as { publicKey: PublicKeyCredentialCreationOptions };
    expect(new Uint8Array(options.publicKey.challenge as ArrayBuffer)).toEqual(
      new Uint8Array([9, 8, 7])
    );
    expect(new Uint8Array(options.publicKey.user.id as ArrayBuffer)).toEqual(new Uint8Array([1]));
    const excluded = options.publicKey.excludeCredentials?.[0].id as ArrayBuffer;
    expect(new Uint8Array(excluded)).toEqual(new Uint8Array([250, 251]));

    expect(result).toEqual({
      id: 'cred-1',
      rawId: '-_8',
      type: 'public-key',
      response: {
        clientDataJSON: toB64Url(bytes(1, 2, 3)),
        attestationObject: toB64Url(bytes(4, 5)),
        transports: ['internal'],
      },
      clientExtensionResults: { credProps: { rk: true } },
    });
  });

  it('注册响应缺少 getTransports 时返回空数组', async () => {
    create.mockResolvedValue({
      id: 'c',
      type: 'public-key',
      rawId: bytes(1),
      response: { clientDataJSON: bytes(1), attestationObject: bytes(2) },
      getClientExtensionResults: () => ({}),
    });
    const result = await createPasskeyCredential({
      challenge: 'AQ',
      rp: { name: 'x' },
      user: { id: 'AQ', name: 'a', displayName: 'a' },
      pubKeyCredParams: [],
    });
    expect(result.response.transports).toEqual([]);
  });

  it('凭据为空或类型不对时抛错', async () => {
    create.mockResolvedValue(null);
    await expect(
      createPasskeyCredential({
        challenge: 'AQ',
        rp: { name: 'x' },
        user: { id: 'AQ', name: 'a', displayName: 'a' },
        pubKeyCredParams: [],
      })
    ).rejects.toThrow('Passkey create did not return a public-key credential.');

    get.mockResolvedValue({ type: 'password' });
    await expect(getPasskeyAssertion({ challenge: 'AQ' })).rejects.toThrow(
      'Passkey get did not return a public-key credential.'
    );
  });

  it('断言序列化 userHandle（存在 / 不存在）', async () => {
    const assertion = (userHandle: ArrayBuffer | null) => ({
      id: 'cred-2',
      type: 'public-key',
      rawId: bytes(7),
      response: {
        clientDataJSON: bytes(1),
        authenticatorData: bytes(2),
        signature: bytes(3),
        userHandle,
      },
      getClientExtensionResults: () => ({}),
    });
    get.mockResolvedValueOnce(assertion(bytes(42)));
    const withHandle = await getPasskeyAssertion({
      challenge: toB64Url(bytes(5)),
      allowCredentials: [{ id: toB64Url(bytes(6)), type: 'public-key' }],
    });
    expect(withHandle.response.userHandle).toBe(toB64Url(bytes(42)));
    expect(withHandle.response.signature).toBe(toB64Url(bytes(3)));
    const options = get.mock.calls[0][0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(new Uint8Array(options.publicKey.challenge as ArrayBuffer)).toEqual(new Uint8Array([5]));

    get.mockResolvedValueOnce(assertion(null));
    const withoutHandle = await getPasskeyAssertion({ challenge: 'AQ' });
    expect(withoutHandle.response.userHandle).toBeNull();
  });
});
