# 运行时兼容层移除方案

## 当前决定

从 `1.1.0-beta.26` 开始，项目不再走“保留旧兼容层逐步淘汰”的路线，改为直接硬切。

这意味着：

- `<= 1.1.0-beta.25` 的旧版本客户端，不再保证可以通过自动更新平滑升级
- 这部分用户需要手动重新下载安装 `1.1.0-beta.26` 或更新版本
- 从 `1.1.0-beta.26` 开始，运行时协议、本地状态文件名和本地目录名统一切到新命名

## 本次硬切范围

`1.1.0-beta.26` 起，直接移除下面三类兼容层：

1. 旧状态字段兼容
   - 删除对 `stableSlot / pendingSlot / currentSlot / slots / slotName` 的读取
2. 旧本地路径兼容
   - 不再使用 `runtime-slot-state.json`
   - 不再使用 `runtime-slots`
   - 不再使用 `runtime-slot-cache`
3. 旧发布文件名兼容
   - 不再发布 `slot-*.json`
   - 不再发布 `slot-*.zip`

## 新命名

硬切后的统一命名如下：

- 本地状态文件：`runtime-copy-state.json`
- 运行副本目录：`runtime-copies`
- 运行包缓存目录：`runtime-package-cache`
- 运行包清单：`runtime-package-{channel}-{platform}-{arch}.json`
- 运行包压缩包：`runtime-package-{channel}-{platform}-{arch}-{version}.zip`

## 影响

这次硬切会带来下面这些已知影响：

1. 老版本自动更新链路会断
   - 因为老版本仍然按旧文件名请求运行包清单
2. 老版本用户本地的旧运行副本缓存不会被新版本继续复用
   - 新版本会在新目录下重新建立运行副本
3. 旧版本落盘的启动状态不会被新版本继续读取
   - 新版本只认新结构

这些影响是本次决策明确接受的，不再做向后兼容。

## 发版要求

如果发布 `1.1.0-beta.26` 或后续基于这条线的版本，必须同时做到：

1. 手动通知现有测试用户重新下载安装
2. 在发版说明里写明“旧 beta 版本需要手动重装，自动更新不保证可用”
3. 不再把“旧 beta 可无缝自动升级”作为验收条件
4. 预检和 CI 只校验新命名产物

## 与代码对应

- 运行时状态与路径：[apps/pc/src/main/runtime-copies.ts](../apps/pc/src/main/runtime-copies.ts)
- 自动更新协议：[apps/pc/src/main/auto-updater.ts](../apps/pc/src/main/auto-updater.ts)
- 运行包构建脚本：[apps/pc/scripts/build-runtime-package-assets.mjs](../apps/pc/scripts/build-runtime-package-assets.mjs)
- 发版预检脚本：[apps/pc/scripts/preflight-release.mjs](../apps/pc/scripts/preflight-release.mjs)
- 发布流水线：[.github/workflows/release.yml](../.github/workflows/release.yml)
