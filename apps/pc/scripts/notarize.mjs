import { mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { notarize } from '@electron/notarize';

async function withInlineApiKey(callback) {
  const inlineApiKey = process.env.APPLE_API_KEY;

  if (!inlineApiKey) {
    return callback(undefined);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'novel-editor-notary-'));
  const keyId = process.env.APPLE_API_KEY_ID ?? 'AuthKey';
  const keyPath = path.join(tempDir, `AuthKey_${keyId}.p8`);

  await writeFile(keyPath, inlineApiKey, 'utf8');

  try {
    return await callback(keyPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export default async function notarizeApp(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  if (!existsSync(appPath)) {
    throw new Error(`Cannot find built app for notarization at ${appPath}`);
  }

  const hasApiKeyAuth = Boolean(
    process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY
  );

  if (!hasApiKeyAuth) {
    if (isCi) {
      throw new Error(
        'Missing App Store Connect API key credentials for macOS release build. Configure APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER in CI.'
      );
    }

    console.log('[notarize] Skip notarization because Apple credentials are not configured.');
    return;
  }

  const appBundleId = context.packager.appInfo.id;

  await withInlineApiKey(async (appleApiKeyPath) => {
    await notarize({
      appBundleId,
      appPath,
      appleApiKey: appleApiKeyPath,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
      tool: 'notarytool',
    });
  });

  console.log('[notarize] App notarization completed with App Store Connect API key.');
}
