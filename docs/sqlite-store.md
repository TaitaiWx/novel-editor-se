# SQLite 存储层设计 (`@novel-editor/store`)

## 概述

`packages/store/` 包封装了基于 `better-sqlite3` 的 SQLite 持久化层，为小说编辑器提供结构化数据存储。

## 当前状态

**已接入应用主流程，并成为默认持久化与版本存储层。**

### 已实现的部分

1. **数据库初始化**：`initDatabase(dbDir)` 按项目创建/切换 SQLite 文件，启用 WAL 模式
2. **业务表 + 版本表**：除作品/角色/设定等表外，新增 `version_snapshots`、`version_entries`、`version_blobs`
3. **完整 CRUD 操作**：`novelOps`、`characterOps`、`statsOps`、`settingsOps`、`versionOps`
4. **IPC 通道已注册**：主进程和 preload 已接入 store 相关通道
5. **导入/导出**：支持包含版本快照在内的完整数据库 JSON 导入导出

### 集成方式

应用打开任意项目文件夹时，会自动在项目内创建隐藏目录 `.novel-editor/`，并把数据库放在其中：

```text
<project>/
├─ chapter-01.md
├─ notes/
└─ .novel-editor/
   └─ novel-editor.db
```

这样既保证项目级隔离，也不污染用户可见文件树。

## 表结构

### novels — 作品/项目

| 字段        | 类型        | 说明           |
| ----------- | ----------- | -------------- |
| id          | INTEGER PK  | 自增主键       |
| name        | TEXT        | 作品名         |
| description | TEXT        | 简介           |
| folder_path | TEXT UNIQUE | 对应文件夹路径 |
| created_at  | TEXT        | 创建时间       |
| updated_at  | TEXT        | 更新时间       |

### characters — 角色

| 字段        | 类型       | 说明                          |
| ----------- | ---------- | ----------------------------- |
| id          | INTEGER PK | 自增主键                      |
| novel_id    | INTEGER FK | 所属作品                      |
| name        | TEXT       | 角色名                        |
| role        | TEXT       | 角色定位                      |
| description | TEXT       | 描述                          |
| attributes  | TEXT       | JSON 格式属性（技能、等级等） |
| sort_order  | INTEGER    | 排序                          |

### acts — 幕/剧结构

| 字段        | 类型       | 说明     |
| ----------- | ---------- | -------- |
| id          | INTEGER PK | 自增主键 |
| novel_id    | INTEGER FK | 所属作品 |
| title       | TEXT       | 幕标题   |
| description | TEXT       | 描述     |
| sort_order  | INTEGER    | 排序     |

### scenes — 场景

| 字段       | 类型       | 说明         |
| ---------- | ---------- | ------------ |
| id         | INTEGER PK | 自增主键     |
| act_id     | INTEGER FK | 所属幕       |
| title      | TEXT       | 场景标题     |
| summary    | TEXT       | 摘要         |
| file_path  | TEXT       | 对应文件路径 |
| sort_order | INTEGER    | 排序         |

### outlines — 大纲

| 字段       | 类型              | 说明                 |
| ---------- | ----------------- | -------------------- |
| id         | INTEGER PK        | 自增主键             |
| novel_id   | INTEGER FK        | 所属作品             |
| title      | TEXT              | 标题                 |
| content    | TEXT              | 内容                 |
| parent_id  | INTEGER FK (self) | 父节点，支持树形结构 |
| sort_order | INTEGER           | 排序                 |

### world_settings — 设定资料库

| 字段     | 类型       | 说明                         |
| -------- | ---------- | ---------------------------- |
| id       | INTEGER PK | 自增主键                     |
| novel_id | INTEGER FK | 所属作品                     |
| category | TEXT       | 分类（规则、技能、世界观等） |
| title    | TEXT       | 条目标题                     |
| content  | TEXT       | 正文                         |
| tags     | TEXT       | JSON 标签数组                |

### writing_stats — 写作统计

| 字段             | 类型       | 说明           |
| ---------------- | ---------- | -------------- |
| id               | INTEGER PK | 自增主键       |
| novel_id         | INTEGER FK | 所属作品       |
| date             | TEXT       | 日期           |
| word_count       | INTEGER    | 字数           |
| duration_seconds | INTEGER    | 写作时长（秒） |

### settings — 用户设置

| 字段  | 类型    | 说明   |
| ----- | ------- | ------ |
| key   | TEXT PK | 设置键 |
| value | TEXT    | 设置值 |

### version_snapshots — 版本快照

| 字段        | 类型       | 说明         |
| ----------- | ---------- | ------------ |
| id          | INTEGER PK | 自增主键     |
| novel_id    | INTEGER FK | 所属项目     |
| message     | TEXT       | 版本说明     |
| total_files | INTEGER    | 快照文件数   |
| total_bytes | INTEGER    | 快照总字节数 |
| created_at  | TEXT       | 创建时间     |

### version_entries — 快照文件索引

| 字段          | 类型       | 说明             |
| ------------- | ---------- | ---------------- |
| snapshot_id   | INTEGER FK | 所属快照         |
| relative_path | TEXT       | 项目内相对路径   |
| content_hash  | TEXT FK    | 引用的 Blob 哈希 |
| byte_size     | INTEGER    | 文件大小         |
| is_binary     | INTEGER    | 是否为二进制资源 |
| mime_type     | TEXT       | MIME 类型        |

### version_blobs — 去重内容仓库

| 字段         | 类型    | 说明             |
| ------------ | ------- | ---------------- |
| content_hash | TEXT PK | SHA-256 内容哈希 |
| content      | BLOB    | 文件原始内容     |
| byte_size    | INTEGER | 原始字节数       |
| is_binary    | INTEGER | 是否为二进制     |
| mime_type    | TEXT    | MIME 类型        |

## 技术选型说明

### 为什么选择 SQLite + better-sqlite3

1. **同步 API**：`better-sqlite3` 是同步的，避免了 `node-sqlite3` 的回调/Promise 嵌套，代码简洁
2. **性能**：WAL 模式提供优秀的读写并发性能，远超 JSON 文件读写
3. **零配置**：嵌入式数据库，无需额外安装或运行数据库服务
4. **Electron 友好**：作为 native addon，项目已通过 `electron-builder install-app-deps` 固化 Electron ABI 重建流程
5. **事务支持**：批量操作可用事务保证原子性

### 版本存储策略

为兼顾性能和复杂素材支持，当前采用：

1. **全文件快照语义**：每次保存版本都记录完整文件清单，恢复逻辑简单可靠。
2. **内容去重**：相同文件内容只存一次 Blob，避免图片和二进制资源重复入库。
3. **自动忽略内部目录**：`.novel-editor/`、`.git/`、`node_modules/`、构建目录不会被纳入快照。
4. **文本/二进制分流**：文本直接进入 DiffEditor，图片支持左右版本对比，PDF 支持多页缩略图和页码跳转。
