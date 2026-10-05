// 字数统计逻辑统一维护在 @novel-editor/core，GUI 状态栏与 CLI `ne stats` 共用同一口径
export { analyzeContentStats, buildThousandCharMarkers } from '@novel-editor/core/text-stats';
export type { ContentStats, ThousandCharMarker } from '@novel-editor/core/text-stats';
