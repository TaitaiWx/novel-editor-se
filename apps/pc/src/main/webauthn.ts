import { app, dialog, session } from 'electron';

const MACOS_BUNDLE_ID = 'com.novel-editor.app';
const WEBAUTHN_GROUP_SUFFIX = 'webauthn';

export interface WebAuthnSupportInfo {
  platform: NodeJS.Platform;
  standardApiAvailable: boolean;
  roamingAuthenticatorSupported: boolean;
  touchIdConfigured: boolean;
  touchIdAvailable: boolean;
  keychainAccessGroup: string | null;
  configurationError: string | null;
}

let configured = false;
let configurationError: string | null = null;
let configuredKeychainAccessGroup: string | null = null;

function normalizeTeamId(raw: string | undefined): string | null {
  const teamId = raw?.trim().replace(/\.$/, '');
  return teamId || null;
}

function getAppleTeamId(): string | null {
  return (
    normalizeTeamId(process.env.NOVEL_EDITOR_APPLE_TEAM_ID) ??
    normalizeTeamId(process.env.APPLE_TEAM_ID) ??
    normalizeTeamId(process.env.CSC_TEAM_ID)
  );
}

function getKeychainAccessGroup(): string | null {
  const explicit = process.env.NOVEL_EDITOR_WEBAUTHN_KEYCHAIN_ACCESS_GROUP?.trim();
  if (explicit) return explicit;

  const teamId = getAppleTeamId();
  if (!teamId) return null;
  return `${teamId}.${MACOS_BUNDLE_ID}.${WEBAUTHN_GROUP_SUFFIX}`;
}

function getAccountLabel(account: {
  name?: string;
  displayName?: string;
  userName?: string;
  credentialId?: string;
}): string {
  return (
    account.displayName || account.name || account.userName || account.credentialId || '未知账户'
  );
}

async function selectWebAuthnAccount(
  accounts: Array<{ credentialId: string; name?: string; displayName?: string; userName?: string }>,
  relyingPartyId: string
): Promise<string | null> {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0].credentialId;

  const labels = accounts.map(getAccountLabel);
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '选择登录凭据',
    message: `选择用于 ${relyingPartyId} 的 passkey`,
    buttons: [...labels, '取消'],
    cancelId: labels.length,
    defaultId: 0,
    noLink: true,
  });

  const selected = accounts[result.response];
  return selected?.credentialId ?? null;
}

export function configureWebAuthn(): WebAuthnSupportInfo {
  if (process.platform !== 'darwin') {
    return getWebAuthnSupportInfo();
  }

  if (configured || configurationError) {
    return getWebAuthnSupportInfo();
  }

  const keychainAccessGroup = getKeychainAccessGroup();
  if (!keychainAccessGroup) {
    configurationError =
      'macOS Touch ID passkey requires NOVEL_EDITOR_WEBAUTHN_KEYCHAIN_ACCESS_GROUP or APPLE_TEAM_ID/CSC_TEAM_ID.';
    return getWebAuthnSupportInfo();
  }

  try {
    app.configureWebAuthn({
      touchID: {
        keychainAccessGroup,
        promptReason: 'sign in to $1',
      },
    });
    configured = true;
    configuredKeychainAccessGroup = keychainAccessGroup;
    configurationError = null;
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error);
  }

  return getWebAuthnSupportInfo();
}

export function registerWebAuthnSessionHandlers(): void {
  session.defaultSession.on(
    'select-webauthn-account',
    async (
      event: Electron.Event,
      details: Electron.SelectWebauthnAccountDetails,
      callback: (credentialId?: string | null) => void
    ) => {
      event.preventDefault();
      try {
        const credentialId = await selectWebAuthnAccount(
          details.accounts ?? [],
          details.relyingPartyId || '当前站点'
        );
        callback(credentialId);
      } catch (error) {
        console.warn('选择 WebAuthn 凭据失败:', error);
        callback(null);
      }
    }
  );
}

export function getWebAuthnSupportInfo(): WebAuthnSupportInfo {
  return {
    platform: process.platform,
    standardApiAvailable: true,
    roamingAuthenticatorSupported: true,
    touchIdConfigured: configured,
    touchIdAvailable: process.platform === 'darwin' && configured,
    keychainAccessGroup: configuredKeychainAccessGroup,
    configurationError,
  };
}
