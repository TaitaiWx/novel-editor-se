/**
 * IPC Handler Registry
 *
 * Aggregates all domain-specific handler modules.
 * Each module is self-contained and registers its own ipcMain.handle calls.
 *
 * Domain split:
 * - file-system: File I/O, directory ops, watchers, clipboard
 * - database:    SQLite CRUD, settings, AI cache, import/export
 * - ai:          AI API requests, analysis reports, assistant window
 * - documents:   XLSX/PPTX/DOCX reading, document export/import
 * - versioning:  Git-like version snapshots
 * - window-app:  Window controls, shortcuts, updates, app info
 */
export { registerFileSystemHandlers } from './file-system';
export { registerDatabaseHandlers } from './database';
export { registerAIHandlers } from './ai';
export { registerDocumentHandlers } from './documents';
export { registerVersionHandlers } from './versioning';
export { registerWindowAppHandlers } from './window-app';

export type { FileNode } from './file-system';
