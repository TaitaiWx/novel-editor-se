# Passkey / WebAuthn 接入

客户端已具备 WebAuthn（Passkey）基础能力，供将来的账号登录使用；目前**没有账号服务，也没有界面调用**这些函数。本文说明已有能力、后端需要做什么，以及各平台的打包要求。

相关代码：

- 主进程：`apps/pc/src/main/webauthn.ts`（`configureWebAuthn`、`registerWebAuthnSessionHandlers`、`getWebAuthnSupportInfo`），在 `main/index.ts` 启动时调用；IPC `get-webauthn-support`（`main/handlers/window-app.ts`）
- 渲染进程：`apps/pc/src/render/utils/webauthn.ts`（`getPasskeyCapability`、`createPasskeyCredential`、`getPasskeyAssertion`，JSON ↔ base64url 序列化）
- 测试：`apps/pc/test/render/utils/webauthn.test.ts`
- 打包：`apps/pc/resources/entitlements.mac.plist` + `apps/pc/signing/mac-sign.mjs`（electron-builder `mac.sign` 官方钩子）

## 已有能力

- macOS 根据实际签名权限与内嵌 provisioning profile 调用 `app.configureWebAuthn()`；只有明确提供匹配授权 profile 的证书包才配置 Touch ID。默认无 profile 的正式证书包，以及 ad-hoc / 未签名包，均禁用 Touch ID。同一网站有多个账号时可弹出系统对话框选择
- `getPasskeyCapability()` 检测当前环境（标准 API、外置安全钥匙、Touch ID 是否已配置 / 可用）
- `createPasskeyCredential()` / `getPasskeyAssertion()` 调用标准 WebAuthn API，入参为后端给出的 `PublicKeyCredential*OptionsJSON`，返回可直接发回后端的序列化结果

## 后端需要做的

1. 注册：生成 `PublicKeyCredentialCreationOptionsJSON`（challenge、rp、user、pubKeyCredParams）→ 客户端 `createPasskeyCredential()` → 校验 attestation / clientDataJSON / challenge / origin，保存公钥
2. 登录：生成 `PublicKeyCredentialRequestOptionsJSON` → 客户端 `getPasskeyAssertion()` → 校验 assertion、challenge、origin、签名计数器，签发会话

## 平台要求

| 平台            | 说明                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS           | 签名钩子校验明确提供的 profile 与实际证书、团队、应用和 Keychain group；运行时再次校验内嵌 profile 和已签权限。环境变量不能覆盖能力                                                                   |
| Windows / Linux | Electron 没有等价于 macOS `configureWebAuthn({ touchID })` 的配置；可用 Chromium WebAuthn 与外置 FIDO2 安全钥匙。Windows Hello / Linux 本机 passkey 需在目标系统实测，并保留密码、验证码或 OAuth 兜底 |

默认 entitlements 不包含 `$(TeamIdentifierPrefix)`，也不声明受限的 `keychain-access-groups`。codesign 不会展开 Xcode 宏；即便 `codesign --verify` 通过，缺少授权 profile 的受限 Keychain 权限仍可能让 AMFI 拒绝应用启动。Data Protection Keychain 的访问组授权要求见 [Apple TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)。默认无 profile 时保留正式证书签名并关闭 Touch ID，不自动搜索或嵌入未知 profile。

需要 Touch ID 的发布者须在 electron-builder 的 `mac.provisioningProfile` 明确指定 Apple 签发的 macOS profile。`mac-sign.mjs` 只读所选 SHA1 对应的实际 X509 证书，取得 OU Team ID，再校验 profile 的团队、App ID（`<TEAM_ID>.com.novel-editor.app`）、有效期、平台、访问组授权及当前签名证书。访问组必须授权 `<TEAM_ID>.com.novel-editor.app.webauthn`（可用限定于该团队的末尾通配符）；无关的已过期证书不会否定仍获授权的当前证书。缺失权限、错误团队、错误证书、过期或未生效 profile 均明确拒绝签名。随后只向主应用添加具体权限，委托 `@electron/osx-sign` 嵌入 profile 并完成整个 bundle 签名；Helper 保留原参数。无证书的 ad-hoc 包不能启用此能力。

运行时 `webauthn-signature.ts` 验证完整 bundle 的代码签名，读取已签权限和 `Contents/embedded.provisionprofile`，重新校验团队、应用、唯一 Keychain group、期限与平台，并通过 codesign requirement 将实际叶证书绑定到 profile 的有效授权证书列表。系统仍负责校验 Apple CMS 信任与设备资格。失败仅禁用 Touch ID，不阻止编辑器运行。`touchIdConfigured` 表示上述校验与配置成功，`touchIdAvailable` 还要求 `systemPreferences.canPromptTouchID()` 返回真。

UT 覆盖缺 profile、授权不匹配、过期、合法 profile 委托、真实 X509 证书解析，以及包含 NSData 证书和 NSDate 日期的真实 XML 解析；macOS 测试调用系统 plutil，避免只用 JSON mock。测试证书未导入系统钥匙串，也不作为生产签名证明。本次没有匹配的真实 Apple profile，具备授权 profile 的正式包 Touch ID 注册/登录仍须实机验收。

## CI 与设备验收

跨平台 CI 检查签名/profile 校验逻辑、原生脚本和 Electron 启动，不声称验证生物识别硬件或完整账号登录。Touch ID / Windows Hello 的设备、用户权限与取消流程验收见 [跨平台验证边界](platform-validation.md)。
