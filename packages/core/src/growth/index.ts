/**
 * 角色成长记录器 / 设定记忆库（纯逻辑，不依赖 Node.js / Electron）
 *
 * 渲染进程通过 `@novel-editor/core/growth` 引入；文件读写见 ./storage（仅主进程与 CLI 使用）。
 */
export * from './types';
export * from './templates';
export {
  normalizeRuleset,
  normalizeSheet,
  normalizePartyBook,
  normalizeAtlas,
  normalizeCoreRuleCheck,
} from './normalize';
export * from './engine';
export * from './party-map';
export * from './consistency';
export * from './simulate-prompt';
export * from './simulate';
export * from './markdown';
export * from './context';
