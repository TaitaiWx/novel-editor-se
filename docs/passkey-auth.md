# Passkey / WebAuthn 登录接入

Electron 42 已接入 WebAuthn 基础能力：

- 主进程在 macOS 上通过 `app.configureWebAuthn()` 启用 Touch ID / Secure Enclave。
- 渲染进程可通过 `getPasskeyCapability()` 检测当前环境是否可用。
- 渲染进程可通过 `createPasskeyCredential()` 和 `getPasskeyAssertion()` 调用标准 WebAuthn API。

账号服务仍必须由后端完成以下工作：

1. 注册时生成 `PublicKeyCredentialCreationOptionsJSON`，包含 challenge、rp、user、pubKeyCredParams。
2. 客户端调用 `createPasskeyCredential()`。
3. 后端验证 attestation / clientDataJSON / challenge / origin，并保存 credential public key。
4. 登录时生成 `PublicKeyCredentialRequestOptionsJSON`。
5. 客户端调用 `getPasskeyAssertion()`。
6. 后端验证 assertion、challenge、origin、签名计数器，并签发账号 session。

macOS Touch ID 打包要求：

- `apps/pc/resources/entitlements.mac.plist` 需要包含 `keychain-access-groups`。
- 运行时 keychain group 优先读取 `NOVEL_EDITOR_WEBAUTHN_KEYCHAIN_ACCESS_GROUP`。
- 如果没有显式设置，则从 `NOVEL_EDITOR_APPLE_TEAM_ID`、`APPLE_TEAM_ID` 或 `CSC_TEAM_ID` 派生：
  `TEAM_ID.com.novel-editor.app.webauthn`。

Windows / Linux：

- Electron 42 没有提供等价于 macOS `configureWebAuthn({ touchID })` 的平台配置。
- 可以使用 Chromium WebAuthn 能力和外置 FIDO2 安全钥匙。
- Windows Hello / Linux 本机 passkey 需要在目标系统上实测，并保留密码、验证码或 OAuth fallback。
