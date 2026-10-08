# 版本管理（项目快照与版本对比）

作者的「版本」是项目文件的快照：存在项目自己的 SQLite 数据库里，不依赖 Git。本文说明快照的存储方式、IPC、版本历史界面与 DiffEditor。应用自身的发版与更新见 [release-process.md](release-process.md)。

相关代码：

- 快照逻辑：`packages/store/src/versioning.ts`（`versionOps`）；表结构：`packages/store/src/db/schema.ts`
- 主进程 IPC：`apps/pc/src/main/handlers/versioning.ts`
- 版本历史弹窗：`apps/pc/src/render/components/VersionTimeline/`（状态栏「版本历史」打开）
- 文本对比：`apps/pc/src/render/components/DiffEditor/`（`@codemirror/merge`）；AI 修改 / 大纲版本的内联对比：`components/InlineDiffView`（算法在 `@novel-editor/basic-algorithm` 的 `diff/`）

## 为什么不用 Git

- 作者不需要预装 Git / LFS，也不需要理解提交、分支等概念
- 业务数据本来就在 SQLite，快照也放在同一个库里，避免双数据源
- 删除 / 重命名版本在 Git 里是改写历史，不适合普通用户
- SQLite 嵌入式、事务原子、WAL 稳定，文本与二进制可统一建模

## 存储

数据库位于 `<project>/.novel-editor/novel-editor.db`（表结构总览见 [sqlite-store.md](sqlite-store.md)），快照用三张表：

| 表                  | 内容                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `version_snapshots` | 一次快照的元信息：说明、文件数、总字节数、创建时间（挂在项目根的 novels 记录上） |
| `version_entries`   | 快照包含的文件：相对路径 → 内容哈希、大小、是否二进制、MIME           |
| `version_blobs`     | 内容本体，按 SHA-256 去重存为 BLOB                                    |

- 内容寻址：相同内容只存一次；删除快照后清理孤儿 Blob
- 全文件快照语义：每个快照记录完整文件清单，恢复逻辑简单
- 扫描时忽略 `.git`、`.novel-editor`、`.vscode`、`node_modules`、`dist`、`build`、`out`、`.DS_Store`
- 文本、Markdown / JSON、图片、音频、视频、PDF、其他二进制统一入库

## IPC

| 通道                          | 用途                             |
| ----------------------------- | -------------------------------- |
| `db-version-start-create`     | 启动后台快照任务（大项目）       |
| `db-version-job-status`       | 轮询任务进度（已处理文件 / 字节） |
| `db-version-create`           | 同步创建快照                     |
| `db-version-list`             | 快照列表                         |
| `db-version-rename` / `db-version-delete` | 重命名 / 删除快照     |
| `db-version-get-file-content` | 读取某快照中的文件内容           |
| `db-version-restore-file`     | 把当前文件恢复到某快照           |

## 流程

1. **打开项目**：自动创建或打开 `.novel-editor/novel-editor.db`，没有记录时注册到 `novels` 表
2. **保存版本**：先收集文件清单与总字节数，再分批读取、计算哈希与 MIME；与最近一次快照完全一致时不新建。大项目以异步任务执行，界面显示进度条
3. **查看历史**：版本弹窗按当前文件过滤快照，可搜索、按时间筛选；选中后按类型预览：

| 类型       | 预览                                       |
| ---------- | ------------------------------------------ |
| 文本       | 打开 DiffEditor 并排对比                   |
| 图片       | 历史 / 当前左右对比                        |
| PDF        | 多页缩略图、主预览、页码跳转               |
| 音频       | 双播放器 + 波形 + 元信息                   |
| 视频       | 双播放器预览                               |
| 其他二进制 | MIME、大小等元信息对比                     |

4. **恢复**：把当前文件恢复到所选快照

## DiffEditor

基于 `@codemirror/merge` 的 `MergeView`，替换中间编辑区显示（App 的 `diffState`），关闭后回到编辑器。用于版本对比与 AI 修复确认。

| 属性            | 类型         | 说明                                 |
| --------------- | ------------ | ------------------------------------ |
| `original`      | `string`     | 左侧原文                             |
| `modified`      | `string`     | 右侧修改后                           |
| `originalLabel` | `string?`    | 左侧标签，默认「原始版本」           |
| `modifiedLabel` | `string?`    | 右侧标签，默认「修改版本」           |
| `onClose`       | `() => void` | 关闭                                 |
| `onAccept`      | `() => void` | 接受变更（AI 修复确认时才传入）      |

两侧只读、暗色主题、行号，支持上一处 / 下一处差异跳转。

## 边界与后续

- 不支持：按文件夹或整项目恢复、远程同步
- 视频等大文件目前同样纳入快照，没有单独排除
- 可能的方向：增量快照缓存减少重复 IO；快照标签 / 星标；把人物、大纲、设定等结构化数据纳入同一时间轴（大纲已有独立的「大纲版本」`outline_versions`）
