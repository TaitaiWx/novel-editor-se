/**
 * 文档导出模块：将 Markdown 内容导出为 Word (.docx) 和 PPT (.pptx)
 *
 * 业界标准库：
 * - docx (npm) — 成熟的 Word 文档生成库，支持表格、目录、样式
 * - pptxgenjs (npm) — 成熟的 PowerPoint 生成库，支持背景、动画、母版
 *
 * 目录结构：
 * - markdown.ts        Markdown → 结构化节点
 * - word.ts            Word 生成与导出
 * - project.ts         整个文件夹合并导出为 Word
 * - pptx.ts            PPT 生成与导出
 * - pptx-beautify.ts   读取现有 PPT 并用统一主题重新生成
 * - jszip.ts           jszip CJS/ESM 兼容加载
 * - save.ts            保存对话框 + 写盘
 */
export { parseMarkdown, parseInlineFormatting, parseTableRow } from './markdown';
export type { MarkdownNode, TextSegment } from './markdown';
export { buildWordBuffer, exportToWord } from './word';
export type { WordExportOptions } from './word';
export { exportProjectToWord } from './project';
export { buildPptxBuffer, exportToPptx } from './pptx';
export type { PptxExportOptions } from './pptx';
export { beautifyPptx } from './pptx-beautify';
export { loadJSZip } from './jszip';
