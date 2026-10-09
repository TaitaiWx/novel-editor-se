import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { resolveCertificateTeam, signWithWebAuthn } from '../../signing/mac-sign.mjs';
const certificate = await readFile(path.resolve('apps/pc/test/fixtures/signing-team.pem'), 'utf8');
const fingerprint = new X509Certificate(certificate).fingerprint.replaceAll(':', '');
const profile = () => ({
  TeamIdentifier: ['ABCDEFGHIJ'],
  ApplicationIdentifierPrefix: ['ABCDEFGHIJ'],
  CreationDate: new Date('2020-01-01'),
  ExpirationDate: new Date('2099-01-01'),
  Platform: ['OSX'],
  DeveloperCertificates: [new X509Certificate(certificate).raw],
  Entitlements: {
    'com.apple.application-identifier': 'ABCDEFGHIJ.com.novel-editor.app',
    'com.apple.developer.team-identifier': 'ABCDEFGHIJ',
    'keychain-access-groups': ['ABCDEFGHIJ.*'],
  },
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe('macOS signing capability', () => {
  it('uses only the exact chosen certificate fingerprint and its subject OU', () => {
    expect(resolveCertificateTeam(fingerprint, certificate)).toBe('ABCDEFGHIJ');
    expect(() => resolveCertificateTeam('0'.repeat(40), certificate)).toThrow();
    expect(() => resolveCertificateTeam('Developer ID Application', certificate)).toThrow();
  });
  it('adds a concrete group only to main entitlements and delegates all signing options', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ne-sign-'));
    dirs.push(dir);
    const entitlements = path.join(dir, 'base.plist');
    await writeFile(
      entitlements,
      '<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>'
    );
    const main = '/temporary/Novel Editor.app';
    const originalOptions = {
      entitlements,
      hardenedRuntime: true,
      additionalArguments: ['--test-argument'],
    };
    let generated = '';
    const listCertificates = vi.fn(async () => certificate);
    const sign = vi.fn(async (opts: import('app-builder-lib').CustomMacSignOptions) => {
      expect(opts.identity).toBe(fingerprint);
      expect(opts.provisioningProfile).toBe('/temporary/app.provisionprofile');
      expect(opts.preEmbedProvisioningProfile).toBe(true);
      expect(opts.optionsForFile?.(`${main}/Contents/Frameworks/Helper.app`)).toBe(originalOptions);
      const mainOptions = opts.optionsForFile?.(main);
      expect(mainOptions).toMatchObject({
        hardenedRuntime: true,
        additionalArguments: ['--test-argument'],
      });
      expect(typeof mainOptions?.entitlements).toBe('string');
      generated = mainOptions?.entitlements as string;
      const text = await readFile(generated, 'utf8');
      expect(text).toContain('<string>ABCDEFGHIJ.com.novel-editor.app.webauthn</string>');
      expect(text).toContain('com.apple.security.cs.allow-jit');
      expect(text).not.toContain('$(TeamIdentifierPrefix)');
    });
    await signWithWebAuthn(
      {
        app: main,
        identity: fingerprint,
        identityValidation: false,
        keychain: '/temporary/build.keychain',
        provisioningProfile: '/temporary/app.provisionprofile',
        optionsForFile: () => originalOptions,
      },
      { listCertificates, sign, decodeProfile: async () => profile() }
    );
    expect(sign).toHaveBeenCalledTimes(1);
    expect(listCertificates).toHaveBeenCalledWith('/temporary/build.keychain');
    await expect(readFile(generated)).rejects.toThrow();
  });
  it('ad-hoc signing does not query certificates or add keychain privileges', async () => {
    const listCertificates = vi.fn(async () => {
      throw new Error('must not read keychain');
    });
    const sign = vi.fn(async () => {});
    await signWithWebAuthn({ app: '/tmp/App.app', identity: '-' }, { listCertificates, sign });
    expect(sign).toHaveBeenCalledWith({
      app: '/tmp/App.app',
      identity: '-',
      identityValidation: false,
      preEmbedProvisioningProfile: false,
    });
    expect(listCertificates).not.toHaveBeenCalled();
  });
  it('fails before signing if supplied entitlements contain a different team or macro', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ne-sign-'));
    dirs.push(dir);
    const entitlements = path.join(dir, 'bad.plist');
    await writeFile(
      entitlements,
      '<plist version="1.0"><dict><key>keychain-access-groups</key><array><string>$(TeamIdentifierPrefix)com.novel-editor.app.webauthn</string></array></dict></plist>'
    );
    const sign = vi.fn(async () => {});
    await expect(
      signWithWebAuthn(
        { app: '/tmp/App.app', identity: fingerprint, optionsForFile: () => ({ entitlements }) },
        { listCertificates: async () => certificate, sign }
      )
    ).rejects.toThrow('keychain');
    expect(sign).not.toHaveBeenCalled();
  });
});

it('certificate signing without an explicit profile never adds restricted groups', async () => {
  const sign = vi.fn(async (opts: import('app-builder-lib').CustomMacSignOptions) => {
    expect(opts.identity).toBe(fingerprint);
    expect(opts.preEmbedProvisioningProfile).toBe(false);
    expect(opts.optionsForFile).toBeUndefined();
  });
  await signWithWebAuthn(
    { app: '/tmp/App.app', identity: fingerprint },
    { listCertificates: async () => certificate, sign }
  );
  expect(sign).toHaveBeenCalledOnce();
});
it.each(['team', 'appid', 'group', 'certificate', 'expired'] as const)(
  'rejects an unauthorized explicit profile: %s',
  async (problem) => {
    const invalid = profile();
    if (problem === 'team') invalid.TeamIdentifier = ['OTHERTEAM0'];
    if (problem === 'appid')
      invalid.Entitlements['com.apple.application-identifier'] = 'ABCDEFGHIJ.other.app';
    if (problem === 'group') invalid.Entitlements['keychain-access-groups'] = ['OTHERTEAM0.*'];
    if (problem === 'certificate') invalid.DeveloperCertificates = [Buffer.from('other cert')];
    if (problem === 'expired') invalid.ExpirationDate = new Date('2000-01-01');
    const sign = vi.fn(async () => {});
    await expect(
      signWithWebAuthn(
        {
          app: '/tmp/App.app',
          identity: fingerprint,
          provisioningProfile: '/tmp/explicit.provisionprofile',
        },
        { listCertificates: async () => certificate, sign, decodeProfile: async () => invalid }
      )
    ).rejects.toThrow(/profile/i);
    expect(sign).not.toHaveBeenCalled();
  }
);
