# 发布流程与自动更新

本文说明如何发布 Canary / Beta / Stable 版本、客户端如何按通道与灰度比例拿到更新、出问题时如何回退，末尾附每次发版的勾选清单。

相关代码：

- 主进程更新逻辑：`apps/pc/src/main/auto-updater/`（`index.ts` 入口、`channel.ts` 通道推断、`loader.ts` 更新源配置、`rollout.ts` 灰度分桶、`health.ts` 启动健康检测、`policy.ts` 版本指针与回退判定、`rollback.ts` 回退安装包、`constants.ts` 常量）
- 打包配置：`apps/pc/electron-builder.yml`；灰度元数据钩子：`apps/pc/scripts/prepare-update-metadata.mjs`；发布预检：`apps/pc/scripts/preflight-release.mjs`
- 流水线：`.github/workflows/release.yml`（打包与发布）、`.github/workflows/sync-mirror.yml`（同步到镜像）

## 原则

- 使用 electron-builder + electron-updater 官方通道机制与官方更新元数据（`*.yml`）作为版本指针，正常更新沿用官方协议；旧版恢复另有明确的版本能力标记与健康确认协议
- GitHub Releases 是发布源；镜像服务器从 Release 同步，客户端从镜像检查更新
- 灰度用元数据里的 `stagingPercentage`
- 不覆盖重发同一版本号

## 通道

| 通道   | 版本号形态      | electron-updater 通道 | 元数据文件                                           | 默认灰度 |
| ------ | --------------- | --------------------- | ---------------------------------------------------- | -------- |
| Stable | `x.y.z`         | `latest`              | `latest.yml` / `latest-mac.yml` / `latest-linux.yml` | 100%     |
| Beta   | `x.y.z-beta.N`  | `beta`                | `beta*.yml`                                          | 25%      |
| Canary | `x.y.z-alpha.N` | `alpha`               | `alpha*.yml`                                         | 10%      |

通道**由我们决定，用户不可选择**：设置中心没有更新通道、金丝雀计划、灰度分组或崩溃日志上传开关。客户端按安装包版本号推断通道（`resolveUpdateChannel`）：带 `-alpha.` / `-canary.` → Canary，带 `-beta.` → Beta，其余 → Stable。旧版本持久化在 `updater-state.json` 里的用户通道选择会在启动时被覆盖。

内部测试需要强制通道时，用环境变量 `NOVEL_EDITOR_UPDATE_CHANNEL=stable|beta|canary` 启动（非法值忽略），没有界面入口。用户可从应用菜单「检查更新…」或设置中心「关于 → 检查更新」手动检查。

## 更新源

- 客户端用 generic provider 从镜像 `https://dl.wayintech.net/novel-editor/latest` 读取当前通道的元数据（`MIRROR_UPDATE_URL`，请求头带 `X-Device-Id`），避免私有仓库 404 并保证国内可用
- `sync-mirror.yml` 在 `Release` workflow 成功后自动把该 tag 的 Release 资产同步到镜像，也可手动触发并指定 tag
- 回退安装包优先从指定版本的 GitHub Release 解析，不可达时读取镜像版本目录的 manifest；绝不把 `/latest` 当作旧版本。版本、平台、架构、SHA256 与回退协议声明均须匹配。

## 灰度比例

在 `release.yml` 顶层 `env` 中配置，由 `prepare-update-metadata.mjs` 写入元数据的 `stagingPercentage`：

```yaml
NOVEL_EDITOR_STABLE_STAGING_PERCENTAGE: '100'
NOVEL_EDITOR_BETA_STAGING_PERCENTAGE: '25'
NOVEL_EDITOR_CANARY_STAGING_PERCENTAGE: '10'
```

调整灰度只改这里，不需要改主进程更新逻辑。客户端是否命中由本机分桶（`rollout.ts`）与该比例决定。

## 发布命令

在仓库根目录执行，命令会改版本号、打 tag 并推送，tag 触发 `release.yml`：

| 命令                        | 版本变化                                                                          | 通道   |
| --------------------------- | --------------------------------------------------------------------------------- | ------ |
| `pnpm release:canary:minor` | 开新 Canary 线：`x.y.z` → `x.(y+1).0-alpha.0`                                     | Canary |
| `pnpm release:canary`       | `x.y.z-alpha.N` → `x.y.z-alpha.(N+1)`                                             | Canary |
| `pnpm release:minor`        | 开新 Beta 线：`x.y.z` → `x.(y+1).0-beta.0`                                        | Beta   |
| `pnpm release:beta`         | `x.y.z-beta.N` → `x.y.z-beta.(N+1)`                                               | Beta   |
| `pnpm release:stable`       | `npm version minor`：预发布版去掉后缀（`1.1.0-beta.3` → `1.1.0`），正式版升 minor | Stable |

发布前可先运行 `pnpm preflight:release`（自动更新状态机测试 `pnpm test:pc-updater` → typecheck → 构建 → 本平台轻量打包并生成更新元数据 → 打包产物烟雾测试）。

### 单次 Beta 公证例外

macOS 发布默认执行 Apple 公证，并强制 Developer ID 签名。如明确决定发布未公证的 Beta，可将 GitHub Actions 仓库变量 `NOVEL_EDITOR_UNNOTARIZED_TAG` 设置为完整目标标签（例如 `v1.1.0-beta.45`）。只有标签完全匹配且包含 `-beta.` 时跳过公证；变量缺失、其他版本以及正式版仍执行公证。签名、原生测试、打包启动检查和发布资产校验照常执行。例外不会在公证失败时自动启用。

未公证版本的发行说明必须提示：macOS 首次打开可能被拦截，需要用户确认来源后在“系统设置 → 隐私与安全性”选择“仍要打开”（[Apple 说明](https://support.apple.com/102445)）。这不等于通过 Gatekeeper 默认放行，也不能据此声称已完成公证版同等的安装及更新验收。发布后可删除该变量；不要移动已推送的版本标签。

CI 流程：tag 对应提交先校验版本号一致，并通过 `quality` job 的 lint、typecheck、UT；`build` job 多平台（Windows / macOS / Linux × x64 / arm64）打包 → 写入灰度元数据 → 用 `pnpm test:e2e apps/pc/e2e/packaged-smoke.e2e.ts` 对打包产物做烟雾测试 → `publish` job 发布到 GitHub Release → `sync-mirror.yml` 同步镜像。

## 推荐节奏

1. 新功能先发 Canary（10%）
2. 24–48 小时无关键问题，发 Beta（25%）
3. Beta 无崩溃或严重回归，发 Stable
4. 高风险正式版可临时把 Stable 灰度设为 20 → 50 → 100 分阶段推进

## 出问题时

- **灰度阶段发现问题**：不要覆盖同版本重发。修复 → 提升版本号 → 重新发布到同一通道（部分用户可能已拿到坏版本，原地覆盖无法纠正所有客户端）
- **止损**：暂停放量（调低灰度）；必要时把更高通道回退到上一可用版本，修复后发更高版本替代
- **客户端回退**：更新安装前缓存并校验旧版，复制独立恢复器到私有事务目录，持久化下次用户登录的恢复入口，等待恢复器就绪，再保存编辑器并交接安装。恢复器独立于 Electron 运行，旧进程退出后等待 180 秒；目标版本未确认主进程 / 窗口 / 渲染健康（含 JS 执行前原生崩溃）时尝试恢复。健康确认与恢复声明原子仲裁；`rollbackPendingVersion` 只在精确旧版本健康启动后清除，故障版本被隔离。
- **兼容性边界**：新自动更新要求旧版发布包同时声明 `rollbackProtocol: 1` 和 `recoveryProtocol: 1`；清单能力只来自该版本随包发布的标记，不能替历史包补标。首次迁移须手工安装真正实现协议的正式签名版本，该版本发布与缓存完成后才能保护后续自动更新；旧客户端进入首个协议版本的那次升级不具备追溯保护。macOS 要求同团队签名、相同 bundle ID、精确版本及可写安装位置；NSIS 要求系统 PowerShell 策略允许恢复脚本，安装器管理 UAC；AppImage 要求原目录可写；Debian 通过 `pkexec dpkg --install` 请求用户授权，并非无人值守恢复。缺少能力时安装前拒绝并在更新状态显示原因。
- **故障边界**：恢复器使用系统 shell / PowerShell，不依赖已被替换的 Electron；重启后在下次用户登录继续事务，没有安装系统启动服务。macOS 同一已验证目录交换中断可继续完成；原生安装器执行途中被强杀不盲目重放，保留失败现场并等待原安装进程或旧版健康确认。事务重入不等同断电时所有磁盘操作的原子性。真实 macOS 签名、公证、Windows UAC / NSIS、Linux polkit / AppImage 升降级仍需各平台验收；真实子进程故障测试不会覆盖或安装用户应用，不能替代安装验收。协议与平台要求见 [`apps/pc/recovery/README.md`](../apps/pc/recovery/README.md)。
- Release 不允许覆盖同一个 tag 的资产；镜像按版本保留，`latest` 只服务正常更新。

## 发版清单

### 发布前

- [ ] 代码已合并到 `main`，已确认本次通道（Canary / Beta / Stable）
- [ ] 关键路径自测：启动、打开项目、编辑、保存、版本历史、检查更新
- [ ] 版本号不会与已发布版本重复
- [ ] 灰度比例符合本次策略（`release.yml` 顶层 `env`），高风险改动已考虑降低比例
- [ ] `pnpm preflight:release` 通过

### 执行

- [ ] 执行对应发布命令（见上表）

### CI

- [ ] `Release` workflow 的 `build`（含打包烟雾测试）全部通过
- [ ] `publish` 通过；失败时不对外宣布发布完成
- [ ] `Sync Release to Mirror` 通过（否则客户端检查不到更新）

### Release 资产

- [ ] Windows / macOS / Linux 安装包都已上传
- [ ] 当前通道的元数据已上传：Stable `latest*.yml`、Beta `beta*.yml`、Canary `alpha*.yml`

### 发布后验证

- [ ] 对应通道的已安装客户端能检查到更新（Beta 客户端也能收到 Stable，Canary 客户端能收到 Canary / Beta / Stable）
- [ ] 下载进度正常，下载完成后右下角出现「重启以更新」
