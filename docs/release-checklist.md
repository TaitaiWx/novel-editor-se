# 发版执行 Checklist

这份文档用于每次发版时逐项勾选。建议发布负责人按顺序执行，不要跳步。

## A. 发布前确认

- [ ] 当前要发布的代码已经合并到主分支
- [ ] 本次发布范围已经确认：Canary / Beta / Stable
- [ ] 关键改动已经完成自测：启动、打开项目、编辑、保存、版本历史、自动更新入口可见
- [ ] 已执行 `pnpm preflight:release`，并确认双运行副本预检通过
- [ ] 当前版本号策略已确认，不会覆盖重发同一版本
- [ ] 如果本次包含高风险改动，已决定灰度比例是否需要调整
- [ ] 如果本次版本 `>= 1.1.0-beta.26`，已准备手动通知旧 beta 用户重新下载安装

## B. 灰度配置确认

打开 [release.yml](../.github/workflows/release.yml)，确认顶层 `env`：

- [ ] `NOVEL_EDITOR_STABLE_STAGING_PERCENTAGE` 符合本次 Stable 放量策略
- [ ] `NOVEL_EDITOR_BETA_STAGING_PERCENTAGE` 符合本次 Beta 放量策略
- [ ] `NOVEL_EDITOR_CANARY_STAGING_PERCENTAGE` 符合本次 Canary 放量策略

默认建议：

- [ ] Canary 保持 10
- [ ] Beta 保持 25
- [ ] Stable 保持 100

如果本次是高风险正式版，可临时把 Stable 改为 20 或 50，观察后再提升到 100。

## C. 执行发布命令

按本次目标通道执行对应命令：

### Canary

- [ ] 如果是新一轮 Canary，执行：

```bash
pnpm release:canary:minor
```

- [ ] 如果是继续同一轮 Canary，执行：

```bash
pnpm release:canary
```

### Beta

- [ ] 如果是新一轮 Beta，执行：

```bash
pnpm release:minor
```

- [ ] 如果是继续同一轮 Beta，执行：

```bash
pnpm release:beta
```

### Stable

- [ ] 如果是正式发布，执行：

```bash
pnpm release:stable
```

## D. CI 过程检查

在 GitHub Actions 中检查 `Release` workflow：

- [ ] `build` job 全部通过
- [ ] `Publish release` 通过

如果 `build` 或 `Publish release` 失败，不继续对外宣布发布完成。

## E. Release 资产核对

到当前 tag 对应的 GitHub Release 页面核对：

- [ ] Windows 安装包已上传
- [ ] macOS 安装包已上传
- [ ] Linux 安装包已上传
- [ ] 当前通道对应的 yml 文件已上传
- [ ] 当前通道对应的运行包清单已上传
- [ ] 当前通道对应的运行包压缩包已上传

通道对应关系：

- [ ] Stable 对应 `latest*.yml`
- [ ] Beta 对应 `beta*.yml`
- [ ] Canary 对应 `alpha*.yml`
- [ ] Stable 对应 `runtime-package-latest-{platform}-{arch}.json`
- [ ] Beta 对应 `runtime-package-beta-{platform}-{arch}.json`
- [ ] Canary 对应 `runtime-package-alpha-{platform}-{arch}.json`

## F. 发布后验证

至少找一台对应通道的已安装客户端做验证：

- [ ] Stable 客户端能检查到 Stable 更新
- [ ] Beta 客户端能检查到 Beta 或 Stable 更新
- [ ] Canary 客户端能检查到 Canary / Beta / Stable 更新
- [ ] 下载进度能正常显示
- [ ] 下载完成后能看到“重启以更新”
- [ ] 重启后新版本进入非活动运行副本并被切为当前版本
- [ ] 人为制造坏运行副本时，launcher 会自动回退到旧副本
- [ ] 如果当前版本 `>= 1.1.0-beta.26`，已验证旧 beta 客户端不会再被视为自动升级兼容范围

## G. 异常处理

如果灰度阶段发现问题：

- [ ] 不覆盖重发同一版本
- [ ] 先修复问题
- [ ] 提升版本号
- [ ] 重新发布到同一通道

如果需要止损：

- [ ] 暂停继续放量
- [ ] 必要时把更高通道回退到上一可用版本
- [ ] 在修复后发一个更高版本替代问题版本
