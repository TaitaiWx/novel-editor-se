import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateProvisioningProfile } from '../../signing/provisioning-profile.mjs';
import { readProvisioningProfileFields } from '../../src/main/webauthn-signature';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const plist = builderRequire('plist') as {
  build: (value: unknown) => string;
  parse: (value: string) => unknown;
};
const cert = new X509Certificate(readFileSync('apps/pc/test/fixtures/signing-team.pem'));
const fingerprint = cert.fingerprint.replaceAll(':', '');
const profile = {
  TeamIdentifier: ['ABCDEFGHIJ'],
  ApplicationIdentifierPrefix: ['ABCDEFGHIJ'],
  Platform: ['OSX'],
  CreationDate: new Date('2020-01-01T00:00:00Z'),
  ExpirationDate: new Date('2099-01-01T00:00:00Z'),
  DeveloperCertificates: [cert.raw],
  Entitlements: {
    'com.apple.application-identifier': 'ABCDEFGHIJ.com.novel-editor.app',
    'com.apple.developer.team-identifier': 'ABCDEFGHIJ',
    'keychain-access-groups': ['ABCDEFGHIJ.*'],
  },
};
const xml = plist.build(profile);
describe('actual XML provisioning plist data and dates', () => {
  it('uses the signing parser with NSData and NSDate instead of JSON-only fixtures', () => {
    expect(xml).toContain('<data>');
    expect(xml).toContain('<date>');
    expect(validateProvisioningProfile(plist.parse(xml), 'ABCDEFGHIJ', fingerprint)).toEqual({
      appId: 'ABCDEFGHIJ.com.novel-editor.app',
      group: 'ABCDEFGHIJ.com.novel-editor.app.webauthn',
      fingerprints: [fingerprint],
    });
  });
  it.skipIf(process.platform !== 'darwin')(
    'extracts real XML with system plutil and preserves certificate bytes and expiration',
    () => {
      const parsed = readProvisioningProfileFields(xml);
      expect(parsed.ExpirationDate).toBe('2099-01-01T00:00:00Z');
      expect(parsed.DeveloperCertificates).toEqual([cert.raw.toString('base64')]);
      expect(validateProvisioningProfile(parsed, 'ABCDEFGHIJ', fingerprint).group).toBe(
        'ABCDEFGHIJ.com.novel-editor.app.webauthn'
      );
    }
  );
  it('rejects a future creation date and an unsupported profile platform', () => {
    expect(() =>
      validateProvisioningProfile(
        { ...profile, CreationDate: new Date('2090-01-01') },
        'ABCDEFGHIJ',
        fingerprint
      )
    ).toThrow('not yet valid');
    expect(() =>
      validateProvisioningProfile({ ...profile, Platform: ['iOS'] }, 'ABCDEFGHIJ', fingerprint)
    ).toThrow('macOS');
  });
});
