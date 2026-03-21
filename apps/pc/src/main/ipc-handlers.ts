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
 */
import {
  registerFileSystemHandlers,
  registerDatabaseHandlers,
  registerAIHandlers,
  registerDocumentHandlers,
  registerVersionHandlers,
  registerWindowAppHandlers,
} from './handlers';

export { type FileNode } from './handlers';

export function setupIPC() {
  registerFileSystemHandlers();
  registerDatabaseHandlers();
  registerAIHandlers();
  registerDocumentHandlers();
  registerVersionHandlers();
  registerWindowAppHandlers();
}
