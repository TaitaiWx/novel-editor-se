# Passkey / WebAuthn 接入

客户端已具备 WebAuthn（Passkey）基础能力，供将来的账号登录使用；目前**没有账号服务，也没有界面调用**这些函数。本文说明已有能力、后端需要做什么，以及各平台的打包要求。

相关代码：

- 主进程：`apps/pc/src/main/webauthn.ts`（`configureWebAuthn`、`registerWebAuthnSessionHandlers`、`getWebAuthnSupportInfo`），在 `main/index.ts` 启动时调用；IPC `get-webauthn-support`（`main/handlers/window-app.ts`）
- 渲染进程：`apps/pc/src/render/utils/webauthn.ts`（`getPasskeyCapability`、`createPasskeyCredential`、`getPasskeyAssertion`，JSON ↔ base64url 序列化）
- 测试：`apps/pc/test/render/utils/webauthn.test.ts`
- 打包：`apps/pc/resources/entitlements.mac.plist`

## 已有能力

- macOS 上主进程通过 `app.configureWebAuthn()` 启用 Touch ID / Secure Enclave；同一网站有多个账号时弹出系统对话框选择
- `getPasskeyCapability()` 检测当前环境（标准 API、外置安全钥匙、Touch ID 是否已配置 / 可用）
- `createPasskeyCredential()` / `getPasskeyAssertion()` 调用标准 WebAuthn API，入参为后端给出的 `PublicKeyCredential*OptionsJSON`，返回可直接发回后端的序列化结果

## 后端需要做的

1. 注册：生成 `PublicKeyCredentialCreationOptionsJSON`（challenge、rp、user、pubKeyCredParams）→ 客户端 `createPasskeyCredential()` → 校验 attestation / clientDataJSON / challenge / origin，保存公钥
2. 登录：生成 `PublicKeyCredentialRequestOptionsJSON` → 客户端 `getPasskeyAssertion()` → 校验 assertion、challenge、origin、签名计数器，签发会话

## 平台要求

| 平台            | 说明                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| macOS           | entitlements 需包含 `keychain-access-groups`；运行时 keychain group 优先读 `NOVEL_EDITOR_WEBAUTHN_KEYCHAIN_ACCESS_GROUP`，否则由 `NOVEL_EDITOR_APPLE_TEAM_ID` / `APPLE_TEAM_ID` / `CSC_TEAM_ID` 派生为 `<TEAM_ID>.com.novel-editor.app.webauthn` |
| Windows / Linux | Electron 没有等价于 macOS `configureWebAuthn({ touchID })` 的配置；可用 Chromium WebAuthn 与外置 FIDO2 安全钥匙。Windows Hello / Linux 本机 passkey 需在目标系统实测，并保留密码、验证码或 OAuth 兜底 |
