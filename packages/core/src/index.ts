/**
 * @novel-editor/core
 *
 * CLI 与 GUI 共享的纯 Node 核心逻辑：文件操作、搜索替换、文本统计、项目/作品/章节模型、导出、写作日志、GUI 会话文件。
 * 本包不依赖 Electron，可在任何 Node.js 20+ 环境中运行。
 */
export * from './errors';
export * from './glob';
export * from './text-stats';
export * from './fs-ops';
export * from './fs-workspace';
export * from './search';
export * from './story-layout';
export * from './project';
export * from './writing-log';
export * from './gui-session';
export * from './export';
export * from './growth';
export * from './growth/storage';
export * from './work-scope';
export * from './entity-media';
export * from './internal-data';
export * from './novel-format';
export * from './structure-rules';
export * from './structure-config';
export * from './workspace-lock';
