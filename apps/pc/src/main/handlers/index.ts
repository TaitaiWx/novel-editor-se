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
 * - growth:      角色成长记录器（资料/记忆/ 中的规则、角色卡、队伍、地图、AI 推演）
 * - memory:      数据库人物卡/设定 → 资料/记忆/ 只读快照
 * - session:     GUI 会话文件（.novel-editor/session.json，供 CLI ne status 读取）
 * - about:       「关于小说编辑器」信息、数据目录与外部链接
 */
export { registerFileSystemHandlers } from './file-system';
export { registerDatabaseHandlers } from './database';
export { registerAIHandlers } from './ai';
export { registerDocumentHandlers } from './documents';
export { registerVersionHandlers } from './versioning';
export { registerWindowAppHandlers } from './window-app';
export { registerGrowthHandlers } from './growth';
export { registerMemoryHandlers } from './memory';
export { registerSessionHandlers } from './session';
export { registerAboutHandlers } from './about';

export type { FileNode } from './file-system';
