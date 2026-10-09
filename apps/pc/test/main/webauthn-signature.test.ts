import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readSignedWebAuthnGroup } from '../../src/main/webauthn-signature';
const signature =
  'Identifier=com.novel-editor.app\nTeamIdentifier=ABCDEFGHIJ\nAuthority=Developer ID Application: Example\n';
const group = 'ABCDEFGHIJ.com.novel-editor.app.webauthn';
const certificate = new X509Certificate(readFileSync('apps/pc/test/fixtures/signing-team.pem'));
const profile = () => ({
  TeamIdentifier: ['ABCDEFGHIJ'],
  ApplicationIdentifierPrefix: ['ABCDEFGHIJ'],
  Platform: ['OSX'],
  CreationDate: '2020-01-01T00:00:00Z',
  ExpirationDate: '2099-01-01T00:00:00Z',
  DeveloperCertificates: [certificate.raw.toString('base64')],
  Entitlements: {
    'com.apple.application-identifier': 'ABCDEFGHIJ.com.novel-editor.app',
    'com.apple.developer.team-identifier': 'ABCDEFGHIJ',
    'keychain-access-groups': ['ABCDEFGHIJ.*'],
  },
});
function runner(
  options: {
    signature?: string;
    group?: unknown;
    verify?: number;
    missingProfile?: boolean;
    profile?: ReturnType<typeof profile>;
    unauthorizedCertificate?: boolean;
  } = {}
) {
  return vi.fn((command: string, args: readonly string[], input?: string) => {
    if (args.includes('--verify'))
      return {
        status: args.includes('-R') && options.unauthorizedCertificate ? 1 : (options.verify ?? 0),
        stdout: '',
        stderr: '',
      };
    if (command.endsWith('security'))
      return { status: options.missingProfile ? 1 : 0, stdout: '<profile/>', stderr: '' };
    if (command.endsWith('plutil') && args.includes('-extract')) {
      const value = (options.profile ?? profile())[args[1] as keyof ReturnType<typeof profile>];
      const stdout =
        args[2] === 'raw'
          ? String(value)
          : args[1] === 'DeveloperCertificates'
            ? `<plist><array>${(value as string[]).map((cert) => `<data>${cert}</data>`).join('')}</array></plist>`
            : `<field key="${args[1]}"/>`;
      return { status: 0, stdout, stderr: '' };
    }
    if (command.endsWith('plutil') && input?.startsWith('<field')) {
      const key = /key="([^"]+)"/.exec(input)![1] as keyof ReturnType<typeof profile>;
      return { status: 0, stderr: '', stdout: JSON.stringify((options.profile ?? profile())[key]) };
    }
    if (command.endsWith('plutil'))
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify({
          'keychain-access-groups': options.group ?? [group],
          'com.apple.application-identifier': 'ABCDEFGHIJ.com.novel-editor.app',
          'com.apple.developer.team-identifier': 'ABCDEFGHIJ',
        }),
      };
    if (args.includes('--entitlements')) return { status: 0, stdout: '<plist/>', stderr: '' };
    return { status: 0, stdout: '', stderr: options.signature ?? signature };
  });
}
describe('signed WebAuthn capability', () => {
  it('verifies the app signature and binds its entitlement to the actual team and bundle', () => {
    const run = runner();
    expect(
      readSignedWebAuthnGroup('/Applications/Novel Editor.app/Contents/MacOS/Novel Editor', run)
    ).toBe(group);
    expect(run.mock.calls[0]).toEqual([
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '/Applications/Novel Editor.app'],
      undefined,
    ]);
  });
  it.each([
    { verify: 1 },
    { signature: 'Identifier=com.novel-editor.app\nTeamIdentifier=not set\nSignature=adhoc' },
    { signature: 'Identifier=other.app\nTeamIdentifier=ABCDEFGHIJ' },
    { group: ['OTHERTEAM0.com.novel-editor.app.webauthn'] },
    { group: ['$(TeamIdentifierPrefix)com.novel-editor.app.webauthn'] },
    { group: [group, 'untrusted.other.group'] },
  ])('rejects invalid/unbound signatures and entitlements: %j', (options) => {
    expect(() =>
      readSignedWebAuthnGroup(
        '/Applications/Novel Editor.app/Contents/MacOS/Novel Editor',
        runner(options)
      )
    ).toThrow();
  });
});

it.each(['missing', 'team', 'group', 'expired', 'certificate'] as const)(
  'does not report usable Touch ID with an unauthorized embedded profile: %s',
  (problem) => {
    const invalid = profile();
    if (problem === 'team') invalid.TeamIdentifier = ['OTHERTEAM0'];
    if (problem === 'group') invalid.Entitlements['keychain-access-groups'] = ['OTHERTEAM0.*'];
    if (problem === 'expired') invalid.ExpirationDate = '2000-01-01T00:00:00Z';
    expect(() =>
      readSignedWebAuthnGroup(
        '/Applications/Novel Editor.app/Contents/MacOS/Novel Editor',
        runner({
          profile: invalid,
          missingProfile: problem === 'missing',
          unauthorizedCertificate: problem === 'certificate',
        })
      )
    ).toThrow();
  }
);
