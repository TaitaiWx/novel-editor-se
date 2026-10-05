/**
 * Database IPC Handlers
 *
 * Handles: SQLite CRUD, settings, AI cache, data import/export
 * 各领域的 handler 拆分在 ./database/ 目录下，这里按原顺序统一注册
 */
import { registerProjectHandlers } from './database/project';
import { registerOutlineHandlers } from './database/outline';
import { registerStoryIdeaHandlers } from './database/story-idea';
import { registerWorldSettingHandlers } from './database/world-setting';
import { registerSettingsAndCacheHandlers } from './database/settings-cache';
import { registerImportExportHandlers } from './database/import-export';

export { isPathInWorkspace } from './database/workspace-path';

export function registerDatabaseHandlers(): void {
  registerProjectHandlers();
  registerOutlineHandlers();
  registerStoryIdeaHandlers();
  registerWorldSettingHandlers();
  registerSettingsAndCacheHandlers();
  registerImportExportHandlers();
}
