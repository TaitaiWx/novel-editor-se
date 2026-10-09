import { X509Certificate } from 'node:crypto';

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid provisioning profile dictionary');
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {unknown} value */
function date(value) {
  return value instanceof Date
    ? value.getTime()
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN;
}
/**
 * Validate the authorization in a decoded CMS provisioning profile. The OS still
 * validates Apple's CMS trust and device eligibility when launching the signed app.
 * @param {unknown} value
 * @param {string} team
 * @param {string | undefined} [signerFingerprint]
 * @param {number} [now]
 */
export function validateProvisioningProfile(value, team, signerFingerprint, now = Date.now()) {
  const profile = record(value);
  const entitlements = record(profile.Entitlements);
  const appId = `${team}.com.novel-editor.app`;
  const group = `${appId}.webauthn`;
  if (
    !Array.isArray(profile.TeamIdentifier) ||
    profile.TeamIdentifier.length !== 1 ||
    profile.TeamIdentifier[0] !== team ||
    !Array.isArray(profile.ApplicationIdentifierPrefix) ||
    !profile.ApplicationIdentifierPrefix.includes(team) ||
    entitlements['com.apple.application-identifier'] !== appId ||
    entitlements['com.apple.developer.team-identifier'] !== team
  ) {
    throw new Error('Provisioning profile Team ID / App ID mismatch');
  }
  if (
    !Array.isArray(profile.Platform) ||
    !profile.Platform.some((platform) => platform === 'OSX' || platform === 'macOS')
  ) {
    throw new Error('Provisioning profile is not for macOS');
  }
  if (!(date(profile.CreationDate) <= now && date(profile.ExpirationDate) > now))
    throw new Error('Provisioning profile is expired or not yet valid');
  const groups = entitlements['keychain-access-groups'];
  if (
    !Array.isArray(groups) ||
    !groups.some(
      (allowed) =>
        typeof allowed === 'string' &&
        (allowed === group ||
          (allowed.endsWith('*') &&
            !allowed.slice(0, -1).includes('*') &&
            allowed.startsWith(`${team}.`) &&
            group.startsWith(allowed.slice(0, -1))))
    )
  ) {
    throw new Error('Provisioning profile does not authorize the keychain group');
  }
  if (!Array.isArray(profile.DeveloperCertificates) || !profile.DeveloperCertificates.length)
    throw new Error('Provisioning profile has no authorized signing certificates');
  const fingerprints = profile.DeveloperCertificates.map((value) => {
    try {
      const cert = new X509Certificate(
        typeof value === 'string'
          ? Buffer.from(value, 'base64')
          : Buffer.isBuffer(value)
            ? value
            : new Uint8Array()
      );
      if (!(Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) > now)) return null;
      return cert.fingerprint.replaceAll(':', '').toUpperCase();
    } catch {
      throw new Error('Provisioning profile contains an invalid or expired certificate');
    }
  }).filter((value) => value !== null);
  if (!fingerprints.length)
    throw new Error('Provisioning profile has no currently valid signing certificate');
  if (signerFingerprint && !fingerprints.includes(signerFingerprint.toUpperCase()))
    throw new Error('Provisioning profile does not authorize the selected signing certificate');
  return { appId, group, fingerprints };
}
