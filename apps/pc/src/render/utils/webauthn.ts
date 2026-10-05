import type { WebAuthnSupportInfo } from '../types/electron-api';

export type Base64UrlString = string;

export interface PasskeyCapability {
  secureContext: boolean;
  webAuthnApiAvailable: boolean;
  platformAuthenticatorAvailable: boolean;
  electron: WebAuthnSupportInfo | null;
  readyForPlatformPasskey: boolean;
}

export interface PublicKeyCredentialDescriptorJSON {
  id: Base64UrlString;
  type: PublicKeyCredentialType;
  transports?: AuthenticatorTransport[];
}

export interface PublicKeyCredentialUserEntityJSON {
  id: Base64UrlString;
  name: string;
  displayName: string;
}

export interface PublicKeyCredentialCreationOptionsJSON {
  challenge: Base64UrlString;
  rp: PublicKeyCredentialRpEntity;
  user: PublicKeyCredentialUserEntityJSON;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: Base64UrlString;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface SerializedPasskeyRegistration {
  id: string;
  rawId: Base64UrlString;
  type: PublicKeyCredentialType;
  response: {
    clientDataJSON: Base64UrlString;
    attestationObject: Base64UrlString;
    transports: AuthenticatorTransport[];
  };
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
}

export interface SerializedPasskeyAssertion {
  id: string;
  rawId: Base64UrlString;
  type: PublicKeyCredentialType;
  response: {
    clientDataJSON: Base64UrlString;
    authenticatorData: Base64UrlString;
    signature: Base64UrlString;
    userHandle: Base64UrlString | null;
  };
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
}

function base64UrlToArrayBuffer(value: Base64UrlString): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): Base64UrlString {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toCredentialDescriptor(
  descriptor: PublicKeyCredentialDescriptorJSON
): PublicKeyCredentialDescriptor {
  return {
    ...descriptor,
    id: base64UrlToArrayBuffer(descriptor.id),
  };
}

function toCreationOptions(
  options: PublicKeyCredentialCreationOptionsJSON
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64UrlToArrayBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToArrayBuffer(options.user.id),
    },
    excludeCredentials: options.excludeCredentials?.map(toCredentialDescriptor),
  };
}

function toRequestOptions(
  options: PublicKeyCredentialRequestOptionsJSON
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64UrlToArrayBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map(toCredentialDescriptor),
  };
}

function assertPublicKeyCredential(
  credential: Credential | null,
  operation: 'create' | 'get'
): asserts credential is PublicKeyCredential {
  if (!credential || credential.type !== 'public-key') {
    throw new Error(`Passkey ${operation} did not return a public-key credential.`);
  }
}

export async function getPasskeyCapability(): Promise<PasskeyCapability> {
  const webAuthnApiAvailable =
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined';
  const secureContext = window.isSecureContext;
  const electron =
    ((await window.electron?.ipcRenderer
      ?.invoke('get-webauthn-support')
      .catch(() => null)) as WebAuthnSupportInfo | null) ?? null;
  const platformAuthenticatorAvailable =
    webAuthnApiAvailable &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
      : false;

  return {
    secureContext,
    webAuthnApiAvailable,
    platformAuthenticatorAvailable,
    electron,
    readyForPlatformPasskey:
      secureContext && webAuthnApiAvailable && platformAuthenticatorAvailable,
  };
}

export async function createPasskeyCredential(
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<SerializedPasskeyRegistration> {
  const credential = await navigator.credentials.create({
    publicKey: toCreationOptions(options),
  });
  assertPublicKeyCredential(credential, 'create');

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
      transports:
        typeof response.getTransports === 'function'
          ? (response.getTransports() as AuthenticatorTransport[])
          : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export async function getPasskeyAssertion(
  options: PublicKeyCredentialRequestOptionsJSON
): Promise<SerializedPasskeyAssertion> {
  const credential = await navigator.credentials.get({
    publicKey: toRequestOptions(options),
  });
  assertPublicKeyCredential(credential, 'get');

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle ? arrayBufferToBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}
