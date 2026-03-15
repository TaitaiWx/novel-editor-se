import { existsSync } from 'fs';
import path from 'path';
import { notarize } from '@electron/notarize';

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

  const appleApiKeyPath = process.env.APPLE_API_KEY_PATH;
  const hasApiKeyAuth = Boolean(
    process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER && appleApiKeyPath
  );

  if (!hasApiKeyAuth) {
    if (isCi) {
      throw new Error(
        'Missing App Store Connect API key credentials for macOS release build. Configure APPLE_API_KEY_PATH, APPLE_API_KEY_ID and APPLE_API_ISSUER in CI.'
      );
    }

    console.log('[notarize] Skip notarization because Apple credentials are not configured.');
    return;
  }

  await notarize({
    appPath,
    appleApiKey: appleApiKeyPath,
    appleApiKeyId: process.env.APPLE_API_KEY_ID,
    appleApiIssuer: process.env.APPLE_API_ISSUER,
  });
  console.log('[notarize] App notarization completed with App Store Connect API key.');
}
