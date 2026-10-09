import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { validateProvisioningProfile } from '../../signing/provisioning-profile.mjs';

const BUNDLE_ID = 'com.novel-editor.app';
interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type SignatureCommand = (
  command: string,
  args: readonly string[],
  input?: string
) => CommandResult;
const execute: SignatureCommand = (command, args, input) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input,
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

/** Plist dates/data cannot be converted wholesale to JSON; extract by their native types. */
export function readProvisioningProfileFields(
  xml: string,
  run: SignatureCommand = execute
): Record<string, unknown> {
  const extract = (key: string, format: string) => {
    const result = run(
      '/usr/bin/plutil',
      ['-extract', key, format === 'json' ? 'xml1' : format, '-o', '-', '--', '-'],
      xml
    );
    if (result.status !== 0) throw new Error(`Touch ID provisioning profile 字段无效：${key}`);
    if (format !== 'json') return result.stdout;
    // plutil validates the original plist before extraction for JSON output.
    const json = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], result.stdout);
    if (json.status !== 0) throw new Error(`Touch ID provisioning profile 字段无法读取：${key}`);
    return json.stdout;
  };
  const profile: Record<string, unknown> = {};
  for (const key of ['TeamIdentifier', 'ApplicationIdentifierPrefix', 'Platform', 'Entitlements'])
    profile[key] = JSON.parse(extract(key, 'json')) as unknown;
  for (const key of ['CreationDate', 'ExpirationDate']) profile[key] = extract(key, 'raw').trim();
  profile.DeveloperCertificates = [
    ...extract('DeveloperCertificates', 'xml1').matchAll(/<data>([A-Za-z0-9+/=\s]*)<\/data>/g),
  ].map((match) => match[1].replace(/\s/g, ''));
  return profile;
}

/** Read only verified signed capabilities, never deployment/environment guesses. */
export function readSignedWebAuthnGroup(
  executable = process.execPath,
  run: SignatureCommand = execute
): string {
  const bundle = path.resolve(path.dirname(executable), '../..');
  if (!bundle.endsWith('.app')) throw new Error('Touch ID 需要有效的 macOS 应用签名');
  const command = (args: string[], input?: string, tool = '/usr/bin/codesign') => {
    const result = run(tool, args, input);
    if (result.status !== 0) throw new Error('Touch ID 代码签名验证失败');
    return result;
  };
  command(['--verify', '--deep', '--strict', bundle]);
  const signature = command(['--display', '--verbose=4', bundle]);
  const details = `${signature.stdout}\n${signature.stderr}`;
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(details)?.[1];
  const identifier = /^Identifier=(.+)$/m.exec(details)?.[1];
  if (!team || identifier !== BUNDLE_ID || /^Signature=adhoc$/m.test(details)) {
    throw new Error('Touch ID 需要证书签名与匹配的应用标识');
  }
  const plist = command(['--display', '--entitlements', ':-', bundle]).stdout;
  const parsed: unknown = JSON.parse(
    command(['-convert', 'json', '-o', '-', '--', '-'], plist, '/usr/bin/plutil').stdout
  );
  const groups =
    parsed && typeof parsed === 'object' && 'keychain-access-groups' in parsed
      ? parsed['keychain-access-groups']
      : null;
  const expected = `${team}.${BUNDLE_ID}.webauthn`;
  if (!Array.isArray(groups) || groups.length !== 1 || groups[0] !== expected) {
    throw new Error('Touch ID 钥匙串权限与签名团队不匹配');
  }
  const embedded = path.join(bundle, 'Contents', 'embedded.provisionprofile');
  const decoded = command(['cms', '-D', '-i', embedded], undefined, '/usr/bin/security');
  const authorization = validateProvisioningProfile(
    readProvisioningProfileFields(decoded.stdout, run),
    team
  );
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('com.apple.application-identifier' in parsed) ||
    parsed['com.apple.application-identifier'] !== authorization.appId ||
    !('com.apple.developer.team-identifier' in parsed) ||
    parsed['com.apple.developer.team-identifier'] !== team
  ) {
    throw new Error('Touch ID 已签应用权限与 provisioning profile 不匹配');
  }
  // Bind the actual leaf certificate to the profile's authorized certificate list.
  const requirement = authorization.fingerprints
    .map((hash) => `certificate leaf = H"${hash}"`)
    .join(' or ');
  command(['--verify', '--strict', '-R', requirement, bundle]);
  return expected;
}
