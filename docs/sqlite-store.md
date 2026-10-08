# SQLite 存储层（`@novel-editor/store`）

`packages/store` 基于 better-sqlite3 提供项目级结构化存储：作品、人物、设定、大纲、创意卡、设置、版本快照、视频任务等。本文说明数据库位置、作品作用域、表结构与导入导出。

相关代码：

- 连接与表结构：`packages/store/src/db/connection.ts`（`initDatabase`，WAL）、`db/schema.ts`（建表 + 增量迁移 `migrateTables`）
- 各表操作：`db/novels.ts`、`characters.ts`、`world-settings.ts`、`outlines.ts`、`story-ideas.ts`、`settings.ts`、`stats.ts`、`ai-cache.ts`、`video-tasks.ts`；版本快照 `versioning.ts`
- 作品作用域与旧数据迁移：`db/work-scope.ts`；种子数据：`db/seed.ts`（`seedProjectData`）；导入导出：`db/export-import.ts`
- 主进程 IPC：`apps/pc/src/main/handlers/database/`、`handlers/database.ts`、`handlers/versioning.ts`（通道均以 `db-` 开头，白名单在 `preload.ts`）
- 原生模块：better-sqlite3 由 `electron-rebuild` 针对 Electron ABI 重建（`apps/pc` postinstall），本地补丁 `patches/better-sqlite3@12.10.0.patch`

## 位置与作用域

```text
<project>/
├─ novels/<作品>/...
└─ .novel-editor/
   └─ novel-editor.db      # 一个项目一个库（.gitignore 忽略，示例作品集不随包分发数据库）
```

- 每部作品一条 `novels` 记录（`folder_path` = 作品目录的绝对路径）；`*-by-folder` IPC 传作品路径即按作品读写。项目根的记录只承载版本快照与写作统计
- 普通文件夹（没有 `ne init`）整体视为一部作品
- 打开项目时（`db-init`）：只有一部作品且它还没有内容时，项目根记录下的旧人物 / 设定 / 大纲整体改挂到该作品（`migrateProjectContentToWork`）；其他情况不动，旧数据作为「未归属」作用域继续可见
- 示例作品集的人物 / 设定 / 大纲来自 `.novel-editor/seed.json`：`db-init` 后 `seedProjectData` 只在某作品还没有记录时写入，绝不覆盖用户数据

## 表结构

| 表                    | 用途                                   | 要点                                                                                     |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `novels`              | 作品 / 项目                            | `folder_path` 唯一                                                                       |
| `characters`          | 人物                                   | `attributes` 为 JSON（别名、头像、人物设计、声音、图集等）、`sort_order`                 |
| `world_settings`      | 设定资料库                             | `category`、`tags`（JSON）、`attributes`（JSON：分类目录、封面、图集；迁移补列）         |
| `outlines`            | 章纲 / 卷纲 / 作品大纲（树形）         | `scope_kind`（project / volume / chapter）+ `scope_path`、`parent_id`、`anchor_text`、`line_hint` |
| `outline_versions`    | 大纲版本中心                           | `source`（import / rebuild / ai / manual）、`tree_json`、可关联创意卡                    |
| `story_idea_cards`    | 灵感 / 三签创意卡                      | 题眼 / 冲突 / 变形签等字段、`status`                                                     |
| `story_idea_outputs`  | 创意卡衍生候选                         | `type`（logline / scene_hook / outline_direction）                                       |
| `settings`            | 键值设置                               | 设置中心 JSON、卷纲覆盖层等；AI Key 不在这里（见 [roadmap-ai-creative.md](roadmap-ai-creative.md)） |
| `ai_cache`            | AI 结果缓存                            | `(cache_key, type)` 主键                                                                 |
| `video_tasks`         | 场景视频任务                           | `data_json` 存完整任务对象，状态机在 `@novel-editor/video`                               |
| `version_snapshots` / `version_entries` / `version_blobs` | 版本快照 | 见 [version-management.md](version-management.md)                                        |
| `writing_stats`       | 历史遗留，GUI 不读写                   | 每日写作统计以 `.novel-editor/writing-log.json` 为准（core `writing-log.ts`，GUI 与 CLI 共用） |
| `acts` / `scenes`     | 历史遗留，只在导出时带出               | 幕 / 场现在从正文实时提取（[outline-algorithm.md](outline-algorithm.md)）                |

新增列一律在 `migrateTables` 里用 `hasColumn` 判断后 `ALTER TABLE`，保证旧库可直接打开。

## 导入导出

`exportAllData` / `importData`（IPC `db-export` / `db-import`、`db-export-to-file` / `db-import-from-file`）把整个库导出为 JSON，包含作品、人物、设定、大纲及其版本、创意卡与版本快照（含 Blob）。`seed.json` 沿用同一行结构，路径相对项目根。

## 选型

- better-sqlite3 同步 API，代码简单；WAL 模式读写性能好
- 嵌入式、零配置，事务保证批量写入与快照原子性
- 原生模块的 ABI 重建已固化在安装流程中
