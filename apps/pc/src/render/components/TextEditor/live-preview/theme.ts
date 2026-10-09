/**
 * 实时预览样式：与编辑器暗色主题（editor-extensions.ts 的 darkTheme）同一套柔和配色。
 * 使用 EditorView.theme 生成作用域样式，只作用于当前编辑器，不引入全局样式。
 */
import { EditorView } from '@codemirror/view';

const UI_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const MONO_FONT = "'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace";
const ACCENT = 'rgba(140, 100, 220, 0.45)';
const LINK = '#7fa8d6';
const MUTED = '#6b6b6b';
const SURFACE = 'rgba(255, 255, 255, 0.04)';
const BORDER = '#3a3a3a';
// 任务复选框选中时的白色对勾（内联 SVG）
const CHECK_MARK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

export const livePreviewTheme = EditorView.theme({
  // 标题：隐藏 # 后按级别放大
  '.cm-lp-heading': { fontWeight: '600', color: '#e4e4e4', fontFamily: UI_FONT },
  '.cm-lp-h1': { fontSize: '1.6em', lineHeight: '1.5' },
  '.cm-lp-h2': { fontSize: '1.4em', lineHeight: '1.5' },
  '.cm-lp-h3': { fontSize: '1.22em' },
  '.cm-lp-h4': { fontSize: '1.1em' },
  '.cm-lp-h5, .cm-lp-h6': { fontSize: '1em', color: '#c8c8c8' },

  // 展开时的语法标记：淡化显示
  '.cm-lp-syntax': { color: MUTED },

  // 行内样式
  '.cm-lp-strong': { fontWeight: '700', color: '#e8e8e8' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through', color: '#9a9a9a' },
  '.cm-lp-code': {
    fontFamily: MONO_FONT,
    fontSize: '0.92em',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-lp-link': {
    color: LINK,
    textDecoration: 'underline',
    textDecorationColor: 'rgba(127, 168, 214, 0.4)',
    textUnderlineOffset: '2px',
  },

  // 列表 / 任务
  '.cm-lp-bullet': { color: '#9d86d6', padding: '0 2px' },
  '.cm-lp-list-number': { color: '#9d86d6' },
  // 任务复选框：去掉浏览器原生外观，与 components/Checkbox 同一套方框样式（强调色沿用列表符号的紫色）
  '.cm-lp-checkbox': {
    appearance: 'none',
    WebkitAppearance: 'none',
    boxSizing: 'border-box',
    width: '15px',
    height: '15px',
    margin: '0 6px 0 0',
    border: '1px solid #4a4a4a',
    borderRadius: '4px',
    background: '#252526',
    verticalAlign: 'middle',
    cursor: 'pointer',
    transition: 'background-color 0.12s ease, border-color 0.12s ease',
  },
  '.cm-lp-checkbox:hover': { borderColor: '#5a5a5a' },
  '.cm-lp-checkbox:checked': {
    borderColor: '#8c64dc',
    backgroundColor: '#8c64dc',
    backgroundImage: CHECK_MARK,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: '11px 11px',
  },
  '.cm-lp-checkbox:focus-visible': {
    outline: 'none',
    boxShadow: '0 0 0 2px rgba(140, 100, 220, 0.45)',
  },
  '.cm-lp-task-done': { color: '#7d7d7d', textDecoration: 'line-through' },

  // 引用
  '.cm-line.cm-lp-quote': {
    borderLeft: `3px solid ${ACCENT}`,
    paddingLeft: '12px',
    color: '#a9a9a9',
  },

  // 分割线
  '.cm-lp-hr': {
    display: 'inline-block',
    width: '100%',
    height: '1px',
    verticalAlign: 'middle',
    backgroundColor: BORDER,
  },

  // 代码块
  '.cm-line.cm-lp-codeblock': {
    fontFamily: MONO_FONT,
    backgroundColor: SURFACE,
    paddingLeft: '12px',
  },
  '.cm-line.cm-lp-codeblock-begin': { borderTopLeftRadius: '4px', borderTopRightRadius: '4px' },
  '.cm-line.cm-lp-codeblock-end': {
    borderBottomLeftRadius: '4px',
    borderBottomRightRadius: '4px',
  },
  '.cm-lp-code-lang': {
    fontFamily: UI_FONT,
    fontSize: '11px',
    color: '#8a8a8a',
    letterSpacing: '0.3px',
  },

  // 公式与表格源码（展开编辑时）
  '.cm-line.cm-lp-math-src, .cm-line.cm-lp-table-src': { fontFamily: MONO_FONT },
  '.cm-lp-math-src-inline': { fontFamily: MONO_FONT, color: '#c5b6e8' },

  // 渲染结果
  '.cm-lp-math-inline': { padding: '0 1px' },
  // 展示公式比正文宽时在自身内部左右滚动，不撑破版面（不出现竖向滚动）。
  // contain: inline-size 让宽公式不参与 .cm-content 的最小内容宽度计算：否则 MathML 不可断行，
  // .cm-content 被撑宽，整篇正文按更宽的宽度换行并被编辑器右侧裁掉（max-width: 100% 拦不住）
  '.cm-lp-math-display': {
    display: 'block',
    textAlign: 'center',
    padding: '6px 0',
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    contain: 'inline-size',
  },
  '.cm-lp-math-display::-webkit-scrollbar, .cm-lp-table::-webkit-scrollbar': { height: '6px' },
  '.cm-lp-math-display::-webkit-scrollbar-thumb, .cm-lp-table::-webkit-scrollbar-thumb': {
    backgroundColor: 'var(--ui-scrollbar-thumb)',
    borderRadius: '999px',
  },
  '.cm-lp-math math': { fontSize: '1.08em' },
  '.cm-lp-math-preview': {
    margin: '2px 0 6px',
    borderRadius: '4px',
    backgroundColor: SURFACE,
  },
  // 同上：宽表格在自身内部滚动，不撑宽正文
  '.cm-lp-table': {
    padding: '4px 0',
    overflowX: 'auto',
    fontFamily: UI_FONT,
    contain: 'inline-size',
  },
  '.cm-lp-table table': { borderCollapse: 'collapse', fontSize: '13px', minWidth: '40%' },
  '.cm-lp-table th, .cm-lp-table td': {
    border: `1px solid ${BORDER}`,
    padding: '4px 10px',
    textAlign: 'left',
  },
  '.cm-lp-table th': { backgroundColor: 'rgba(255, 255, 255, 0.05)', fontWeight: '600' },
  '.cm-lp-table code': {
    fontFamily: MONO_FONT,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: '3px',
    padding: '0 3px',
  },
  '.cm-lp-image': { display: 'inline-block', maxWidth: '100%', color: MUTED },
  '.cm-lp-image img': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '420px',
    borderRadius: '4px',
    margin: '4px 0',
  },
  '.cm-lp-pending': { color: MUTED, fontFamily: MONO_FONT },

  // 渲染失败：原文 + 细小的错误标记
  '.cm-lp-retry': {
    fontFamily: UI_FONT,
    color: 'var(--ui-fg-primary)',
    background: 'var(--ui-bg-elevated)',
    border: '1px solid var(--ui-border-strong)',
    borderRadius: '4px',
    marginLeft: '8px',
    padding: '2px 6px',
    cursor: 'pointer',
  },
  '.cm-lp-render-error': { color: '#c9a99a' },
  '.cm-lp-raw-source': { whiteSpace: 'pre-wrap', fontFamily: MONO_FONT, textAlign: 'left' },
  '.cm-lp-table.cm-lp-render-error, .cm-lp-math-display.cm-lp-render-error': {
    display: 'block',
    textAlign: 'left',
  },
  '.cm-lp-error-marker': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    marginLeft: '6px',
    borderRadius: '50%',
    fontSize: '10px',
    fontWeight: '700',
    fontFamily: UI_FONT,
    lineHeight: '1',
    verticalAlign: 'middle',
    color: '#e3a58f',
    backgroundColor: 'rgba(227, 165, 143, 0.16)',
    cursor: 'help',
  },
});
