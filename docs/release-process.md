# 发布流程与自动更新

本文说明如何发布 Canary / Beta / Stable 版本、客户端如何按通道与灰度比例拿到更新、出问题时如何回退，末尾附每次发版的勾选清单。

相关代码：

- 主进程更新逻辑：`apps/pc/src/main/auto-updater/`（`index.ts` 入口、`channel.ts` 通道推断、`loader.ts` 更新源配置、`rollout.ts` 灰度分桶、`health.ts` 启动健康检测、`policy.ts` 版本指针与回退判定、`rollback.ts` 回退安装包、`constants.ts` 常量）
- 打包配置：`apps/pc/electron-builder.yml`；灰度元数据钩子：`apps/pc/scripts/prepare-update-metadata.mjs`；发布预检：`apps/pc/scripts/preflight-release.mjs`
- 流水线：`.github/workflows/release.yml`（打包与发布）、`.github/workflows/sync-mirror.yml`（同步到镜像）

## 原则

- 使用 electron-builder + electron-updater 官方通道机制与官方更新元数据（`*.yml`）作为版本指针，不自定义更新协议
- GitHub Releases 是发布源；镜像服务器从 Release 同步，客户端从镜像检查更新
- 灰度用元数据里的 `stagingPercentage`
- 不覆盖重发同一版本号

## 通道

| 通道   | 版本号形态       | electron-updater 通道 | 元数据文件                                  | 默认灰度 |
| ------ | ---------------- | --------------------- | ------------------------------------------- | -------- |
| Stable | `x.y.z`          | `latest`              | `latest.yml` / `latest-mac.yml` / `latest-linux.yml` | 100%     |
| Beta   | `x.y.z-beta.N`   | `beta`                | `beta*.yml`                                 | 25%      |
| Canary | `x.y.z-alpha.N`  | `alpha`               | `alpha*.yml`                                | 10%      |

通道**由我们决定，用户不可选择**：设置中心没有更新通道、金丝雀计划、灰度分组或崩溃日志上传开关。客户端按安装包版本号推断通道（`resolveUpdateChannel`）：带 `-alpha.` / `-canary.` → Canary，带 `-beta.` → Beta，其余 → Stable。旧版本持久化在 `updater-state.json` 里的用户通道选择会在启动时被覆盖。

内部测试需要强制通道时，用环境变量 `NOVEL_EDITOR_UPDATE_CHANNEL=stable|beta|canary` 启动（非法值忽略），没有界面入口。用户可从应用菜单「检查更新…」或设置中心「关于 → 检查更新」手动检查。

## 更新源

- 客户端用 generic provider 从镜像 `https://dl.wayintech.net/novel-editor/latest` 读取当前通道的元数据（`MIRROR_UPDATE_URL`，请求头带 `X-Device-Id`），避免私有仓库 404 并保证国内可用
- `sync-mirror.yml` 在 `Release` workflow 成功后自动把该 tag 的 Release 资产同步到镜像，也可手动触发并指定 tag
- 回退安装包优先从 GitHub API 解析，不可达时用镜像兜底

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

| 命令                        | 版本变化                                       | 通道   |
| --------------------------- | ---------------------------------------------- | ------ |
| `pnpm release:canary:minor` | 开新 Canary 线：`x.y.z` → `x.(y+1).0-alpha.0` | Canary |
| `pnpm release:canary`       | `x.y.z-alpha.N` → `x.y.z-alpha.(N+1)`          | Canary |
| `pnpm release:minor`        | 开新 Beta 线：`x.y.z` → `x.(y+1).0-beta.0`    | Beta   |
| `pnpm release:beta`         | `x.y.z-beta.N` → `x.y.z-beta.(N+1)`            | Beta   |
| `pnpm release:stable`       | `npm version minor`：预发布版去掉后缀（`1.1.0-beta.3` → `1.1.0`），正式版升 minor | Stable |

发布前可先运行 `pnpm preflight:release`（自动更新状态机测试 `pnpm test:pc-updater` → typecheck → 构建 → 本平台轻量打包并生成更新元数据 → 打包产物烟雾测试）。

CI 流程：`build` job 多平台（Windows / macOS / Linux × x64 / arm64）打包 → 写入灰度元数据 → 用 `pnpm test:e2e apps/pc/e2e/packaged-smoke.e2e.ts` 对打包产物做烟雾测试 → `publish` job 发布到 GitHub Release → `sync-mirror.yml` 同步镜像。

## 推荐节奏

1. 新功能先发 Canary（10%）
2. 24–48 小时无关键问题，发 Beta（25%）
3. Beta 无崩溃或严重回归，发 Stable
4. 高风险正式版可临时把 Stable 灰度设为 20 → 50 → 100 分阶段推进

## 出问题时

- **灰度阶段发现问题**：不要覆盖同版本重发。修复 → 提升版本号 → 重新发布到同一通道（部分用户可能已拿到坏版本，原地覆盖无法纠正所有客户端）
- **止损**：暂停放量（调低灰度）；必要时把更高通道回退到上一可用版本，修复后发更高版本替代
- **客户端回退**（GitHub-only 条件下的基础能力，不是 A/B 分区原子切换）：新版本启动后主进程、窗口、渲染进程都就绪才推进 `lastKnownGoodVersion`；新版本连续启动失败达到阈值（`MAX_FAILED_UPDATED_LAUNCHES = 2`）时提示可回退，回退目标的安装包预先缓存在 `userData/rollback-cache/`（最多 2 个），由用户确认后安装旧版本

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
