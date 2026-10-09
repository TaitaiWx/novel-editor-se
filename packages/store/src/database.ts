/**
 * 存储层数据库入口（聚合导出）。实现按领域拆分在 ./db 目录：
 * - connection.ts      连接管理
 * - schema.ts          表结构与迁移
 * - sql-helpers.ts     纯 SQL 构建/行映射工具
 * - novels / characters / world-settings / outlines / story-ideas / stats / settings / ai-cache
 * - export-import.ts   全量导出/导入
 */
export {
  initDatabase,
  isDatabaseReady,
  getDatabase,
  closeDatabase,
  backupDatabaseFile,
} from './db/connection';
export { novelOps } from './db/novels';
export { characterOps } from './db/characters';
export { worldSettingOps } from './db/world-settings';
export { outlineOps, outlineVersionOps } from './db/outlines';
export { storyIdeaOps } from './db/story-ideas';
export { statsOps } from './db/stats';
export { settingsOps } from './db/settings';
export { aiCacheOps } from './db/ai-cache';
export { videoTaskOps } from './db/video-tasks';
export type { VideoTaskRecordLike } from './db/video-tasks';
export { exportAllData, importData } from './db/export-import';
export type { ExportData } from './db/export-import';
export { PROJECT_SEED_FILE, seedProjectData, validateProjectSeed } from './db/seed';
export type { ProjectSeedData, SeedCounts, SeedProjectResult } from './db/seed';
export {
  NOVEL_CONTENT_TABLES,
  countNovelContent,
  ensureNovelByFolder,
  hasNovelContentByFolder,
  migrateProjectContentToWork,
} from './db/work-scope';
export type { NovelContentCounts, WorkContentMigration } from './db/work-scope';
export type {
  OutlineScope,
  OutlineScopeKind,
  OutlineVersionRow,
  OutlineVersionSource,
  StoryIdeaCardRow,
  StoryIdeaCardSource,
  StoryIdeaCardStatus,
  StoryIdeaOutputRow,
  StoryIdeaOutputType,
} from './db/types';
