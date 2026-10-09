/**
 * electron-builder 26 CustomMacSign hook. Derive Touch ID entitlements from the selected
 * certificate's SHA1 / subject OU, then delegate the complete bundle to @electron/osx-sign.
 * https://www.electron.build/mac/ (sign); https://www.electronjs.org/docs/latest/api/app#appconfigurewebauthnconfig-macos
 */
import { validateProvisioningProfile } from './provisioning-profile.mjs';
import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
/** @type {{ signAsync: (options: import('app-builder-lib').CustomMacSignOptions) => Promise<void> }} */
const signer = builderRequire('@electron/osx-sign');
/** @type {{ parse: (text: string) => unknown, build: (value: Record<string, unknown>) => string }} */
const plist = builderRequire('plist');
const exec = promisify(execFile);
const DEFAULT_ENTITLEMENTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../resources/entitlements.mac.plist'
);

/** @param {string} identity @param {string} certificates */
export function resolveCertificateTeam(identity, certificates) {
  if (!/^[a-f\d]{40}$/i.test(identity))
    throw new Error('Signing identity must be an exact certificate SHA1');
  const matches =
    certificates.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  for (const pem of matches) {
    const cert = new X509Certificate(pem);
    if (cert.fingerprint.replaceAll(':', '').toUpperCase() !== identity.toUpperCase()) continue;
    const teams = [...cert.subject.matchAll(/^OU=([A-Z\d]{10})$/gm)];
    if (teams.length !== 1) throw new Error('Signing certificate has no unique Apple Team ID');
    return teams[0][1];
  }
  throw new Error('Selected signing certificate was not found in the signing keychain');
}

/** @param {string | undefined} keychain */
async function listCertificates(keychain) {
  const { stdout } = await exec(
    '/usr/bin/security',
    ['find-certificate', '-a', '-p', ...(keychain ? [keychain] : [])],
    { maxBuffer: 8 * 1024 * 1024, timeout: 10_000 }
  );
  return stdout;
}

/** @param {string} file */
async function decodeProfile(file) {
  const { stdout } = await exec('/usr/bin/security', ['cms', '-D', '-i', file], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
  });
  return plist.parse(stdout);
}

/**
 * @param {import('app-builder-lib').CustomMacSignOptions} options
 * @param {{ listCertificates: (keychain: string | undefined) => Promise<string>, sign: (options: import('app-builder-lib').CustomMacSignOptions) => Promise<void>, decodeProfile?: (path: string) => Promise<unknown> }} [services]
 */
export async function signWithWebAuthn(
  options,
  services = { listCertificates, sign: signer.signAsync }
) {
  const original = options.optionsForFile?.(options.app) ?? {};
  const source = original.entitlements ?? DEFAULT_ENTITLEMENTS;
  const value =
    typeof source === 'string'
      ? plist.parse(await readFile(source, 'utf8'))
      : Object.fromEntries(source.map((name) => [name, true]));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid main entitlements plist');
  const entitlements = /** @type {Record<string, unknown>} */ (value);
  const existing = entitlements['keychain-access-groups'];
  if (!options.provisioningProfile) {
    if (existing !== undefined)
      throw new Error('Restricted keychain entitlements require an explicit provisioning profile');
    await services.sign({
      ...options,
      ...(!options.identity || options.identity === '-'
        ? { identity: '-', identityValidation: false }
        : {}),
      preEmbedProvisioningProfile: false,
    });
    return;
  }
  if (!options.identity || options.identity === '-')
    throw new Error('Provisioning profile requires a certificate signing identity');
  const team = resolveCertificateTeam(
    options.identity,
    await services.listCertificates(options.keychain)
  );
  const authorization = validateProvisioningProfile(
    await (services.decodeProfile ?? decodeProfile)(options.provisioningProfile),
    team,
    options.identity
  );
  const expected = authorization.group;
  if (
    existing !== undefined &&
    (!Array.isArray(existing) || existing.length !== 1 || existing[0] !== expected)
  ) {
    throw new Error('Existing keychain group does not match selected signing certificate');
  }
  entitlements['keychain-access-groups'] = [expected];
  entitlements['com.apple.application-identifier'] = authorization.appId;
  entitlements['com.apple.developer.team-identifier'] = team;
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'novel-editor-entitlements-'));
  const file = path.join(temporary, 'main.plist');
  try {
    await writeFile(file, plist.build(entitlements));
    await services.sign({
      ...options,
      preEmbedProvisioningProfile: true,
      // Keep the exact identity selector and original helper signing settings.
      optionsForFile: (candidate) =>
        candidate === options.app
          ? { ...original, entitlements: file }
          : (options.optionsForFile?.(candidate) ?? {}),
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** @type {import('app-builder-lib').CustomMacSign} */
export default async function sign(options, _packager) {
  await signWithWebAuthn(options);
}
