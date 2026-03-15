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

  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
  const hasApiKeyAuth = Boolean(keychainProfile);

  if (!hasApiKeyAuth) {
    if (isCi) {
      throw new Error(
        'Missing App Store Connect API key credentials for macOS release build. Configure APPLE_KEYCHAIN_PROFILE in CI.'
      );
    }

    console.log('[notarize] Skip notarization because Apple credentials are not configured.');
    return;
  }

  const appBundleId = context.packager.appInfo.id;

  await notarize({
    appBundleId,
    appPath,
    keychainProfile,
    tool: 'notarytool',
  });
  console.log('[notarize] App notarization completed with App Store Connect API key.');
}
