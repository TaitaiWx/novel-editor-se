# 发布流程与自动更新规范

本文档描述小说编辑器当前采用的正式发布流程。目标是保持以下原则：

- 安装器仍使用 Electron Builder 官方产物
- 使用 GitHub Releases 作为唯一发布源
- 运行时更新使用独立的“运行包清单 + 运行包压缩包”
- 使用稳定 launcher + 双运行副本指针，坏版本自动回退到旧副本
- 灰度比例继续沿用 `stagingPercentage` 语义，但写入运行包清单

## 当前发布模型

### 通道定义

- Stable: 面向全量用户，对应官方 `latest` 通道
- Beta: 面向提前验证用户，对应官方 `beta` 通道
- Canary: 面向最小流量验证用户，内部映射到官方 `alpha` 通道

应用内展示仍然使用 `Canary`，但 Electron Updater 底层通道名使用 `alpha`。这是 Electron Builder 官方通道模型的一部分，不建议自定义第四套通道协议。

### 版本指针

当前有两套元数据：

1. 安装器元数据，继续由 Electron Builder 生成：
   - Stable: `latest.yml` / `latest-mac.yml` / `latest-linux.yml`
   - Beta: `beta.yml` / `beta-mac.yml` / `beta-linux.yml`
   - Canary: `alpha.yml` / `alpha-mac.yml` / `alpha-linux.yml`
2. 运行时元数据，新增独立运行包清单：
   - Stable: `slot-latest-{platform}-{arch}.json`
   - Beta: `slot-beta-{platform}-{arch}.json`
   - Canary: `slot-alpha-{platform}-{arch}.json`

真正的运行时版本指针保存在客户端本地 `runtime-slot-state.json`。这个文件名为了兼容历史版本保留不变，但内部字段已经切成 `stableCopy / pendingCopy`，launcher 启动时只从这个根状态读取版本指针，不会从组件 state 推断当前版本。

### 灰度比例

灰度比例定义在 [release.yml](../.github/workflows/release.yml) 的顶层 `env` 中：

- `NOVEL_EDITOR_STABLE_STAGING_PERCENTAGE='100'`
- `NOVEL_EDITOR_BETA_STAGING_PERCENTAGE='25'`
- `NOVEL_EDITOR_CANARY_STAGING_PERCENTAGE='10'`

默认含义：

- Stable 全量发布
- Beta 先放量 25%
- Canary 先放量 10%

这些值会同时影响：

- 官方安装器 `.yml` 中的 `stagingPercentage`
- 运行包清单中的 `stagingPercentage`

## 发布前要改什么

通常不需要手改 workflow。

发布前主要确认三类内容：

1. 代码和版本已经准备好
2. 当前准备发布到哪个通道
3. 当前通道是否需要调整灰度比例
4. 发布前先执行一次 `pnpm preflight:release`

如果要调整灰度比例，只改 [release.yml](../.github/workflows/release.yml) 顶层 `env` 即可，不需要改主进程更新逻辑。

## 正式发布命令

### Canary

开启新的 Canary 线：

```bash
pnpm release:canary:minor
```

效果：

- 版本会变成 `x.y.z-alpha.0`
- 推送 tag 后，CI 以 `alpha` 通道发布
- 生成 `slot-alpha-{platform}-{arch}.json` 和对应运行包压缩包
- 默认灰度比例 10%

继续发布同一条 Canary 线：

```bash
pnpm release:canary
```

效果：

- 版本递增为 `x.y.z-alpha.N`
- 继续写入 `alpha*.yml`
- 继续写入 `slot-alpha-{platform}-{arch}.json`

### Beta

开启新的 Beta 线：

```bash
pnpm release:minor
```

效果：

- 版本会变成 `x.y.z-beta.0`
- 推送 tag 后，CI 以 `beta` 通道发布
- 生成 `slot-beta-{platform}-{arch}.json` 和对应运行包压缩包
- 默认灰度比例 25%

继续发布同一条 Beta 线：

```bash
pnpm release:beta
```

效果：

- 版本递增为 `x.y.z-beta.N`
- 继续写入 `beta*.yml`
- 继续写入 `slot-beta-{platform}-{arch}.json`

### Stable

发布稳定版：

```bash
pnpm release:stable
```

效果：

- 去掉预发布标记，生成正式版本号
- 推送 tag 后，CI 以 `latest` 通道发布
- 生成 `slot-latest-{platform}-{arch}.json` 和对应运行包压缩包
- 默认灰度比例 100%

## 成熟发布流程建议

推荐按下面顺序推进：

1. 新功能先进入 Canary，观察最小流量验证结果
2. Canary 稳定后，提升到 Beta 让更大范围用户验证
3. Beta 稳定后，再发 Stable 全量

对于重要改动，建议这样做：

1. 先发 Canary，保持 10%
2. 若 24 到 48 小时无关键问题，再发 Beta，保持 25%
3. 若 Beta 无崩溃或严重回归，再发 Stable
4. 若 Stable 风险仍偏高，可临时把 Stable 灰度改为 `20`、`50`、`100` 分阶段推进

## 遇到问题时怎么处理

### 灰度阶段发现问题

不要覆盖同版本重发。

正确做法：

1. 修复问题
2. 提升版本号
3. 重新发布到同一通道

双运行副本模式下也一样：不要覆盖坏版本的运行包压缩包，同版本重发会让本地版本指针和缓存状态变得不可验证。

### 需要回退

当前项目实现的是稳定 launcher + A/B 双运行副本运行时：

- 新版本只会下载到非活动运行副本
- launcher 只在新副本健康启动后才提交版本指针
- 若新副本启动失败，launcher 下次启动会自动回退到旧副本
- 用户也可以手动触发恢复，直接把版本指针切回上一可用版本

安装器升级和运行时升级现在是两条链路：

- 安装器升级：面向 launcher 自身升级或首次安装
- 运行时升级：面向日常版本迭代，走运行包压缩包，不直接覆盖当前可用版本

## 与代码的对应关系

- 主进程更新逻辑：[apps/pc/src/main/auto-updater.ts](../apps/pc/src/main/auto-updater.ts)
- 运行副本状态与版本指针：[apps/pc/src/main/runtime-slots.ts](../apps/pc/src/main/runtime-slots.ts)
- Electron Builder 配置：[apps/pc/electron-builder.yml](../apps/pc/electron-builder.yml)
- 灰度元数据构建钩子：[apps/pc/scripts/prepare-update-metadata.mjs](../apps/pc/scripts/prepare-update-metadata.mjs)
- 运行包构建脚本：[apps/pc/scripts/build-runtime-package-assets.mjs](../apps/pc/scripts/build-runtime-package-assets.mjs)
- 发布流水线：[.github/workflows/release.yml](../.github/workflows/release.yml)

## 最小操作清单

如果你现在要发版，按这个最小清单走：

1. 确认代码已经合并到主分支
2. 判断本次是 Canary、Beta 还是 Stable
3. 如需调整灰度，修改 [release.yml](../.github/workflows/release.yml) 顶层 `env`
4. 执行对应发布命令
5. 等待 GitHub Actions 完成打包和发布
6. 在 GitHub Release 中确认安装包、对应通道 `.yml`、运行包清单、运行包压缩包都已上传
7. 在已安装客户端中验证该通道是否能正确下载到非活动运行副本并完成切换

运营执行勾选版见 [docs/release-checklist.md](release-checklist.md)。
