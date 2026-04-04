# 发布流程与自动更新规范

本文档描述小说编辑器当前采用的正式发布流程。目标是保持以下原则：

- 使用 Electron Builder + Electron Updater 官方通道机制
- 使用 GitHub Releases 作为唯一发布源
- 使用官方更新元数据文件作为版本指针
- 使用 `stagingPercentage` 做灰度，而不是自定义更新协议
- 保留 GitHub-only 条件下可落地的基础回退能力

## 当前发布模型

### 通道定义

- Stable: 面向全量用户，对应官方 `latest` 通道
- Beta: 面向提前验证用户，对应官方 `beta` 通道
- Canary: 面向最小流量验证用户，内部映射到官方 `alpha` 通道

应用内展示仍然使用 `Canary`，但 Electron Updater 底层通道名使用 `alpha`。这是 Electron Builder 官方通道模型的一部分，不建议自定义第四套通道协议。

### 版本指针

版本指针不是单独维护的 JSON 文件，而是 Electron Builder 自动生成的官方更新元数据文件：

- Stable: `latest.yml` / `latest-mac.yml` / `latest-linux.yml`
- Beta: `beta.yml` / `beta-mac.yml` / `beta-linux.yml`
- Canary: `alpha.yml` / `alpha-mac.yml` / `alpha-linux.yml`

应用检查更新时，直接读取当前通道对应的官方元数据文件。

### 灰度比例

灰度比例定义在 [release.yml](../.github/workflows/release.yml) 的顶层 `env` 中：

- `NOVEL_EDITOR_STABLE_STAGING_PERCENTAGE='100'`
- `NOVEL_EDITOR_BETA_STAGING_PERCENTAGE='25'`
- `NOVEL_EDITOR_CANARY_STAGING_PERCENTAGE='10'`

默认含义：

- Stable 全量发布
- Beta 先放量 25%
- Canary 先放量 10%

这些值由 [prepare-update-metadata.mjs](../apps/pc/scripts/prepare-update-metadata.mjs) 写入官方更新元数据中的 `stagingPercentage` 字段。

## 发布前要改什么

通常不需要手改 workflow。

发布前主要确认三类内容：

1. 代码和版本已经准备好
2. 当前准备发布到哪个通道
3. 当前通道是否需要调整灰度比例

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
- 默认灰度比例 10%

继续发布同一条 Canary 线：

```bash
pnpm release:canary
```

效果：

- 版本递增为 `x.y.z-alpha.N`
- 继续写入 `alpha*.yml`

### Beta

开启新的 Beta 线：

```bash
pnpm release:minor
```

效果：

- 版本会变成 `x.y.z-beta.0`
- 推送 tag 后，CI 以 `beta` 通道发布
- 默认灰度比例 25%

继续发布同一条 Beta 线：

```bash
pnpm release:beta
```

效果：

- 版本递增为 `x.y.z-beta.N`
- 继续写入 `beta*.yml`

### Stable

发布稳定版：

```bash
pnpm release:stable
```

效果：

- 去掉预发布标记，生成正式版本号
- 推送 tag 后，CI 以 `latest` 通道发布
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

这是 Electron Updater 官方推荐方式，因为部分用户可能已经拿到坏版本，原地覆盖同版本不能稳定纠正所有客户端状态。

### 需要回退

当前项目实现的是 GitHub Releases 条件下可落地的基础回退：

- 下载新版本时记录当前可回退版本
- 新版本连续异常启动时，应用保留回退入口
- 用户可以重新拉起旧版本安装包进行回退

这不是双分区 A/B 原子切换。

如果未来需要真正的 A/B 原子回滚，需要额外引入更重的安装器、分区切换或企业级分发体系。对于当前 GitHub-only 开源分发模式，不建议伪造这种能力。

## 与代码的对应关系

- 主进程更新逻辑：[apps/pc/src/main/auto-updater.ts](../apps/pc/src/main/auto-updater.ts)
- Electron Builder 配置：[apps/pc/electron-builder.yml](../apps/pc/electron-builder.yml)
- 灰度元数据构建钩子：[apps/pc/scripts/prepare-update-metadata.mjs](../apps/pc/scripts/prepare-update-metadata.mjs)
- 发布流水线：[.github/workflows/release.yml](../.github/workflows/release.yml)

## 最小操作清单

如果你现在要发版，按这个最小清单走：

1. 确认代码已经合并到主分支
2. 判断本次是 Canary、Beta 还是 Stable
3. 如需调整灰度，修改 [release.yml](../.github/workflows/release.yml) 顶层 `env`
4. 执行对应发布命令
5. 等待 GitHub Actions 完成打包和发布
6. 在 GitHub Release 中确认安装包和对应通道 `.yml` 文件都已上传
7. 在已安装客户端中验证该通道是否能正确检查到更新

运营执行勾选版见 [docs/release-checklist.md](release-checklist.md)。
