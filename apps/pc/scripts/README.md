# 维护脚本

日常开发用 `pnpm dev`。`run-electron.cjs` 直接启动依赖中的原始 Electron，只负责日志过滤与退出码转发，不复制应用、不改签名。macOS 应用展示名通过打包产物验证。

| 文件                                         | 职责 / 入口                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-electron.cjs`                           | `dev:electron`、`start` 的启动器                                                                                                                |
| `../signing/mac-sign.mjs`                    | electron-builder `mac.sign`：仅在明确提供匹配 profile 时生成主应用 Touch ID 权限并委托官方签名器嵌入；默认证书签名不加受限权限，无证书时 ad-hoc |
| `mac-localized-app-name.mjs`                 | electron-builder 的 afterPack 钩子；只写本地化展示名，随后由打包流程签名                                                                        |
| `preflight-release.mjs`                      | `pnpm preflight:release`：本机发布预检                                                                                                          |
| `prepare-update-metadata.mjs`                | 打包后为更新元数据写通道与灰度比例                                                                                                              |
| `merge-release-artifacts.mjs`                | 合并各架构发布资产，校验版本、通道、大小与摘要后生成发布目录                                                                                    |
| `create-rollback-manifest.mjs`               | 镜像同步时生成指定版本的产物清单、校验值和恢复协议声明                                                                                          |
| `generate-sample-data.mts`                   | 在隔离目录生成示例；默认预览，加 `--write` 才发布，内容哈希和版本一起更新                                                                       |
| `sample-generation.mts`                      | 示例目录验证、跨进程租约、持久化事务记录、暂存发布与崩溃恢复                                                                                    |
| `sample-data-{poem,english,scene}.mts`       | 示例故事、英文结构和场景数据模块；由主生成器调用                                                                                                |
| `sample-content-hash.mts`                    | 示例内容哈希；手工调整素材后可 `--bump` 更新元数据                                                                                              |
| `generate-sample-media.mjs`、`sample-media/` | 用 Electron Canvas / WebCodecs 在隔离目录生成图片、音频与视频；支持 `--only`；默认预览，`--write` 才将素材、seed 和版本指纹统一发布             |
| `live-ai-check.mts`                          | 手工真实服务联调，会调用配置的外部服务；不在默认测试执行                                                                                        |
| `check-script-syntax.mjs`                    | 额外检查 JS/CJS/MJS 的 Node 语法，不执行脚本业务                                                                                                |

`pnpm lint` 包含维护 JS/TS 脚本；`pnpm typecheck` 对 `apps/pc/scripts` 与根目录 `scripts` 的 MTS / JS / CJS / MJS 开启严格 `checkJs`。浏览器 Canvas / WebCodecs 生成器使用明确的参数与全局类型声明。JS 语法检查仍额外保留。

示例生成：`pnpm exec tsx apps/pc/scripts/generate-sample-data.mts [示例目录] [--write]`。非空目标必须有示例标记；拒绝符号链接、正在运行的 GUI 工作区与并行生成。生成与发布持有 core 的跨进程租约，与 GUI / CLI 协作写入互斥。生成前将目标与暂存目录身份（设备号 / inode）持久化到 `.generation.lock`；发布前同步暂存文件与目录。下次调用（包括预览）自动恢复已退出进程的已知事务：第二次 rename 前恢复原目录，第二次 rename 后保留完整新版并清理原备份。正常异常走同一个恢复器。活进程、不完整 / 旧格式 / 身份不符的记录一律保留现场，绝不猜测删除未知锁、暂存或备份。目录 fsync 在 Windows 不可用，不能把强杀恢复保证等同断电保证。

素材生成：在 `apps/pc` 运行 `pnpm exec electron scripts/generate-sample-media.mjs [示例目录] [--only=images,video,audio,scene] [--write]`。媒体与 `seed.json`、场景派生数据、`sampleVersion` / `contentHash` 经 `sample-media-generation.mts` 同一事务发布，不再要求另跑数据生成器。

`.novel-editor` 中只跟踪示例 `config.json`、`seed.json`、`sample.json`，其余运行数据忽略。未使用的 `notarize.mjs` 已删除，正式 macOS 公证仍由 electron-builder 内置流程完成。
