/**
 * 实时预览的「重型」渲染：KaTeX 公式与 Markdown 表格。
 *
 * - 每次渲染都包在 try/catch 中，返回 `{ ok: false, error }` 而不是抛出，
 *   调用方（widget）据此显示原文 + 错误标记，单个坏块不会影响其它内容
 * - 结果按源码字符串缓存在 LRU 中：滚动回来、重复公式、撤销重做都直接命中
 * - KaTeX 输出 MathML（Chromium 原生渲染），无需全局 CSS 与字体文件
 */
import { LruCache } from './lru';

export type RenderResult = ({ ok: true; html: string } | { ok: false; error: string }) & {
  pending?: boolean;
  retryable?: boolean;
};

let katex: typeof import('katex').default | null = null;
let mathLoadError: string | null = null;
let mathLoad: Promise<void> | null = null;
const mathLoadListeners = new Set<() => void>();

/** Pending/failed widgets observe subsequent shared load attempts until ready or retired. */
export function subscribeMathRenderer(listener: () => void): () => void {
  mathLoadListeners.add(listener);
  return () => {
    mathLoadListeners.delete(listener);
  };
}

/** Only formula widgets/cells request this dependency. A failed load can be retried. */
export function loadMathRenderer(): Promise<void> {
  if (katex) return Promise.resolve();
  if (mathLoad) return mathLoad;
  mathLoadError = null;
  mathLoad = import('katex')
    .then((module) => {
      katex = module.default;
    })
    .catch((error: unknown) => {
      mathLoadError = errorMessage(error);
    })
    .finally(() => {
      mathLoad = null;
      for (const listener of [...mathLoadListeners]) listener();
    });
  return mathLoad;
}

const MATH_CACHE_SIZE = 600;
const TABLE_CACHE_SIZE = 200;

const mathCache = new LruCache<string, RenderResult>(MATH_CACHE_SIZE);
const tableCache = new LruCache<string, RenderResult>(TABLE_CACHE_SIZE);

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 转义 HTML 特殊字符 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 渲染公式（带缓存）；display 为 true 时按展示公式排版 */
export function renderMath(source: string, display: boolean): RenderResult {
  const key = `${display ? 'D' : 'I'}\u0000${source}`;
  const cached = mathCache.get(key);
  if (cached) return cached;
  let result: RenderResult;
  if (!source.trim()) {
    result = { ok: false, error: '公式为空' };
  } else if (!katex) {
    if (mathLoadError)
      return { ok: false, error: `公式组件加载失败：${mathLoadError}`, retryable: true };
    void loadMathRenderer();
    return { ok: false, error: '公式加载中', pending: true };
  } else {
    try {
      // 用 throwOnError 拿到具体错误信息，再由外层 catch 转成结果对象，绝不向上抛出
      const html = katex.renderToString(source, {
        displayMode: display,
        output: 'mathml',
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        maxSize: 50,
        maxExpand: 1000,
      });
      result = { ok: true, html };
    } catch (err) {
      result = { ok: false, error: errorMessage(err).replace(/^KaTeX parse error:\s*/, '') };
    }
  }
  mathCache.set(key, result);
  return result;
}

export type TableAlign = 'left' | 'center' | 'right' | null;

export interface ParsedTable {
  header: string[];
  align: TableAlign[];
  rows: string[][];
}

/** 按未转义、且不在行内代码中的 `|` 切分表格行 */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

/** 解析 GFM 表格源码；结构不合法时抛出带中文说明的错误 */
export function parseTable(source: string): ParsedTable {
  const lines = source.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) throw new Error('表格至少需要表头和分隔行');
  const header = splitTableRow(lines[0]);
  const delimiter = splitTableRow(lines[1]);
  if (!delimiter.every((cell) => DELIMITER_CELL.test(cell))) {
    throw new Error('第 2 行不是有效的分隔行（应形如 |---|:---:|）');
  }
  if (delimiter.length !== header.length) {
    throw new Error(`分隔行有 ${delimiter.length} 列，表头有 ${header.length} 列`);
  }
  const align: TableAlign[] = delimiter.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
  const rows = lines.slice(2).map((line, index) => {
    const cells = splitTableRow(line);
    if (cells.length > header.length) {
      throw new Error(`第 ${index + 3} 行有 ${cells.length} 列，多于表头的 ${header.length} 列`);
    }
    while (cells.length < header.length) cells.push('');
    return cells;
  });
  return { header, align, rows };
}

const INLINE_TOKEN =
  /(`+)([\s\S]+?)\1|\$([^$\s](?:[^$]*?[^$\s])?)\$|\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|\*([^*\s][^*]*?)\*/g;

/** 表格单元格内的简易行内渲染：代码、公式、加粗、删除线、斜体，其余转义 */
export function renderInlineCell(text: string): string {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(last, index));
    if (match[2] !== undefined) {
      html += `<code>${escapeHtml(match[2])}</code>`;
    } else if (match[3] !== undefined) {
      const math = renderMath(match[3], false);
      html += math.ok
        ? math.html
        : math.pending
          ? `<span class="cm-lp-pending">${escapeHtml(match[0])}</span>`
          : `<span class="cm-lp-render-error" title="${escapeHtml(math.error)}">${escapeHtml(match[0])}</span>`;
    } else if (match[4] !== undefined) {
      html += `<strong>${escapeHtml(match[4])}</strong>`;
    } else if (match[5] !== undefined) {
      html += `<del>${escapeHtml(match[5])}</del>`;
    } else if (match[6] !== undefined) {
      html += `<em>${escapeHtml(match[6])}</em>`;
    }
    last = index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

const alignAttr = (align: TableAlign) => (align ? ` style="text-align:${align}"` : '');

/** 渲染表格为 HTML（带缓存） */
export function renderTable(source: string): RenderResult {
  const cached = tableCache.get(source);
  if (cached) return cached;
  let result: RenderResult;
  try {
    const table = parseTable(source);
    const containsFormula = [...table.header, ...table.rows.flat()].some((cell) =>
      [...cell.matchAll(INLINE_TOKEN)].some((match) => match[3] !== undefined)
    );
    const head = table.header
      .map((cell, i) => `<th${alignAttr(table.align[i])}>${renderInlineCell(cell)}</th>`)
      .join('');
    const body = table.rows
      .map(
        (row) =>
          `<tr>${row.map((cell, i) => `<td${alignAttr(table.align[i])}>${renderInlineCell(cell)}</td>`).join('')}</tr>`
      )
      .join('');
    result = {
      ok: true,
      html: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
      ...(containsFormula && !katex
        ? mathLoadError
          ? { retryable: true }
          : { pending: true }
        : {}),
    };
  } catch (err) {
    result = { ok: false, error: errorMessage(err) };
  }
  if (!result.pending && !result.retryable) tableCache.set(source, result);
  return result;
}

/** 缓存统计（单测 / 排查用） */
export function getRenderCacheStats() {
  return {
    math: { size: mathCache.size, hits: mathCache.hits, misses: mathCache.misses },
    table: { size: tableCache.size, hits: tableCache.hits, misses: tableCache.misses },
  };
}

export function clearRenderCaches(): void {
  mathCache.clear();
  tableCache.clear();
}

/** 是否已有缓存结果（不计入命中统计之外的副作用：仅用于决定是否需要延迟渲染） */
export function hasCachedMath(source: string, display: boolean): boolean {
  return peekCache(mathCache, `${display ? 'D' : 'I'}\u0000${source}`);
}

export function hasCachedTable(source: string): boolean {
  return peekCache(tableCache, source);
}

function peekCache(cache: LruCache<string, RenderResult>, key: string): boolean {
  const before = { hits: cache.hits, misses: cache.misses };
  const found = cache.get(key) !== undefined;
  cache.hits = before.hits;
  cache.misses = before.misses;
  return found;
}

// ── 渲染预算：同一个任务里重型渲染累计超过预算时，后续 widget 改为下一帧再渲染 ──

const FRAME_BUDGET_MS = 8;
let budgetSpent = 0;
let budgetResetScheduled = false;
/** 测试用：关闭预算限制，所有 widget 同步渲染 */
let budgetUnlimited = false;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 当前任务是否还有渲染预算 */
export function hasRenderBudget(): boolean {
  return budgetUnlimited || budgetSpent < FRAME_BUDGET_MS;
}

/** 执行一次重型渲染并计入预算 */
export function spendRenderBudget<T>(fn: () => T): T {
  const start = now();
  try {
    return fn();
  } finally {
    budgetSpent += now() - start;
    if (!budgetResetScheduled) {
      budgetResetScheduled = true;
      setTimeout(() => {
        budgetSpent = 0;
        budgetResetScheduled = false;
      }, 0);
    }
  }
}

/** 下一帧执行（无 rAF 的环境退化为 setTimeout） */
export function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
}

/** 测试用：清空当前任务已消耗的渲染预算（覆盖率插桩会让 KaTeX 冷启动超过预算） */
export function resetRenderBudgetForTests(): void {
  budgetSpent = 0;
}

/**
 * 测试用：关闭 / 恢复渲染预算。整份文档同步渲染的断言（多个 widget）在机器繁忙时
 * 单次 KaTeX 渲染就可能超过预算，只清空预算不足以保证确定性
 */
export function setRenderBudgetUnlimitedForTests(unlimited: boolean): void {
  budgetUnlimited = unlimited;
  budgetSpent = 0;
}
