export function validateProvisioningProfile(
  value: unknown,
  team: string,
  signerFingerprint?: string,
  now?: number
): { appId: string; group: string; fingerprints: string[] };
