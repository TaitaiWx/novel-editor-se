/**
 * IPC Handler Setup — Thin delegator
 *
 * All handler logic has been split into domain-specific modules under ./handlers/
 * for maintainability, testability, and reusability.
 *
 * Domain modules:
 * - file-system:  File I/O, directory operations, file watchers, clipboard
 * - database:     SQLite CRUD, settings, AI cache, data import/export
 * - ai:           AI API requests, analysis reports, assistant window
 * - documents:    XLSX/PPTX/DOCX reading, document export/import
 * - versioning:   Git-like version snapshots
 * - window-app:   Window controls, shortcuts, updates, app info
 * - growth/memory: 成长记录器与记忆资料快照（资料/记忆/）
 * - session:      GUI 会话文件（供 CLI ne status 读取）
 * - about:        「关于小说编辑器」信息
 */
import {
  registerFileSystemHandlers,
  registerDatabaseHandlers,
  registerAIHandlers,
  registerDocumentHandlers,
  registerVersionHandlers,
  registerWindowAppHandlers,
  registerGrowthHandlers,
  registerMemoryHandlers,
  registerSessionHandlers,
  registerAboutHandlers,
} from './handlers';

export { type FileNode } from './handlers';

export function setupIPC() {
  registerFileSystemHandlers();
  registerDatabaseHandlers();
  registerAIHandlers();
  registerDocumentHandlers();
  registerVersionHandlers();
  registerWindowAppHandlers();
  registerGrowthHandlers();
  registerMemoryHandlers();
  registerSessionHandlers();
  registerAboutHandlers();
}
