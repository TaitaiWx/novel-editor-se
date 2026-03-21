/**
 * 自定义搜索面板 — VS Code 风格，带匹配计数
 *
 * 架构（数据驱动）：
 *   用户操作 → dispatch setSearchQuery → CM6 update → panel.update()
 *     → query/doc 变化: rAF 去抖 → 全量扫描 → 缓存 positions[]
 *     → selection 变化: 二分查找 O(log n) → 更新 current index
 *     → DOM 更新
 *
 * 性能特征：
 *   - 全量扫描: O(n) 仅在 query/doc 变化时触发，rAF 合并
 *   - 当前索引: O(log n) 二分查找，位置缓存命中
 *   - 上限保护: MAX_MATCHES = 10,000，防止超大文档卡顿
 *
 * 使用方式：
 *   import { searchExtensions } from './search-panel';
 *   extensions: [ ...searchExtensions(), keymap.of([...searchKeymap]) ]
 */
import type { Extension } from '@codemirror/state';
import { EditorView, Panel } from '@codemirror/view';
import {
  search,
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
  getSearchQuery,
} from '@codemirror/search';

const MAX_MATCHES = 10_000;

// ─── DOM 辅助 ───────────────────────────────────────────────────────────
function elt(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (string | HTMLElement)[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}

// ─── 二分查找当前匹配索引 ──────────────────────────────────────────────
// positions 按 from 升序排列（getCursor 保证文档序），O(log n)
function binarySearchMatch(
  positions: ReadonlyArray<{ from: number; to: number }>,
  from: number,
  to: number
): number {
  let lo = 0;
  let hi = positions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = positions[mid];
    if (m.from === from && m.to === to) return mid + 1; // 1-based
    if (m.from < from || (m.from === from && m.to < to)) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0; // 未命中
}

// ─── 搜索查询指纹（用于脏检查） ────────────────────────────────────────
function queryFingerprint(q: SearchQuery): string {
  return `${q.search}\0${q.caseSensitive}\0${q.regexp}\0${q.wholeWord}`;
}

// ─── 创建搜索面板 ──────────────────────────────────────────────────────
function createSearchPanel(view: EditorView): Panel {
  const query = getSearchQuery(view.state);

  // ── 搜索输入 ──
  const searchInput = elt('input', {
    class: 'cm-sp-input',
    name: 'search',
    placeholder: '查找',
    'main-field': 'true',
    'aria-label': '查找',
  }) as HTMLInputElement;
  searchInput.value = query.search;

  // ── 替换输入 ──
  const replaceInput = elt('input', {
    class: 'cm-sp-input',
    name: 'replace',
    placeholder: '替换',
    'aria-label': '替换',
  }) as HTMLInputElement;
  replaceInput.value = query.replace;

  // ── 开关状态 ──
  let caseSensitive = query.caseSensitive;
  let wholeWord = false;
  let regexp = query.regexp;

  const toggleBtn = (label: string, title: string, active: boolean): HTMLButtonElement =>
    elt(
      'button',
      { class: `cm-sp-toggle${active ? ' cm-sp-toggle-active' : ''}`, title, type: 'button' },
      label
    ) as HTMLButtonElement;

  const caseBtn = toggleBtn('Aa', '区分大小写', caseSensitive);
  const wordBtn = toggleBtn('ab', '全字匹配', wholeWord);
  const regexBtn = toggleBtn('.*', '正则表达式', regexp);

  // ── 匹配计数 ──
  const matchInfo = elt('span', { class: 'cm-sp-match-info' });

  // ── 导航 ──
  const prevBtn = elt(
    'button',
    { class: 'cm-sp-nav-btn', title: '上一个 (Shift+Enter)', type: 'button' },
    '↑'
  ) as HTMLButtonElement;
  const nextBtn = elt(
    'button',
    { class: 'cm-sp-nav-btn', title: '下一个 (Enter)', type: 'button' },
    '↓'
  ) as HTMLButtonElement;
  const closeBtn = elt(
    'button',
    { class: 'cm-sp-close-btn', title: '关闭 (Esc)', type: 'button', name: 'close' },
    '✕'
  ) as HTMLButtonElement;

  // ── 替换 ──
  const replaceBtn = elt(
    'button',
    { class: 'cm-sp-replace-btn', title: '替换', type: 'button', name: 'replace' },
    '替换'
  ) as HTMLButtonElement;
  const replaceAllBtn = elt(
    'button',
    { class: 'cm-sp-replace-btn', title: '全部替换', type: 'button', name: 'replaceAll' },
    '全部'
  ) as HTMLButtonElement;

  // ── 替换行折叠 ──
  let showReplace = !!query.replace;
  const expandBtn = elt(
    'button',
    {
      class: `cm-sp-expand-btn${showReplace ? ' cm-sp-expand-active' : ''}`,
      title: '切换替换',
      type: 'button',
    },
    showReplace ? '▾' : '▸'
  ) as HTMLButtonElement;

  // ── 布局 ──
  const findRow = elt(
    'div',
    { class: 'cm-sp-find-row' },
    expandBtn,
    searchInput,
    caseBtn,
    wordBtn,
    regexBtn,
    matchInfo,
    prevBtn,
    nextBtn,
    closeBtn
  );

  const replaceRow = elt(
    'div',
    { class: `cm-sp-replace-row${showReplace ? '' : ' cm-sp-hidden'}` },
    replaceInput,
    replaceBtn,
    replaceAllBtn
  );

  const dom = elt('div', { class: 'cm-sp-panel' }, findRow, replaceRow);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  数据层：位置缓存 + 去抖计算
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  let cachedPositions: Array<{ from: number; to: number }> = [];
  let cachedOverflow = false;
  let lastFingerprint = '';
  let rafId = 0;

  /** 全量扫描 — 仅在 query/doc 变化时调用（rAF 去抖） */
  function fullRecompute() {
    const q = getSearchQuery(view.state);
    if (!q.valid || !q.search) {
      cachedPositions = [];
      cachedOverflow = false;
      renderMatchInfo(0, 0, false);
      return;
    }
    const positions: Array<{ from: number; to: number }> = [];
    const iter = q.getCursor(view.state);
    let r = iter.next();
    while (!r.done && positions.length < MAX_MATCHES) {
      positions.push({ from: r.value.from, to: r.value.to });
      r = iter.next();
    }
    cachedPositions = positions;
    cachedOverflow = !r.done;
    const sel = view.state.selection.main;
    const current = binarySearchMatch(positions, sel.from, sel.to);
    renderMatchInfo(positions.length, current, cachedOverflow);
  }

  function scheduleRecompute() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(fullRecompute);
  }

  /** 仅更新当前索引 — 从缓存二分查找 O(log n) */
  function updateCurrentIndex() {
    const sel = view.state.selection.main;
    const current = binarySearchMatch(cachedPositions, sel.from, sel.to);
    renderMatchInfo(cachedPositions.length, current, cachedOverflow);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  视图层：DOM 更新
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  function renderMatchInfo(total: number, current: number, overflow: boolean) {
    if (total === 0) {
      if (searchInput.value) {
        matchInfo.textContent = '无结果';
        matchInfo.className = 'cm-sp-match-info cm-sp-no-match';
      } else {
        matchInfo.textContent = '';
        matchInfo.className = 'cm-sp-match-info';
      }
    } else if (overflow) {
      matchInfo.textContent = current > 0 ? `${current}/${MAX_MATCHES}+` : `${MAX_MATCHES}+ 个结果`;
      matchInfo.className = 'cm-sp-match-info';
    } else if (current > 0) {
      matchInfo.textContent = `${current}/${total}`;
      matchInfo.className = 'cm-sp-match-info';
    } else {
      matchInfo.textContent = `${total} 个结果`;
      matchInfo.className = 'cm-sp-match-info';
    }
  }

  /** 同步开关按钮的激活状态 */
  function syncToggles(q: SearchQuery) {
    if (q.caseSensitive !== caseSensitive) {
      caseSensitive = q.caseSensitive;
      caseBtn.classList.toggle('cm-sp-toggle-active', caseSensitive);
    }
    if (q.regexp !== regexp) {
      regexp = q.regexp;
      regexBtn.classList.toggle('cm-sp-toggle-active', regexp);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  交互层：事件 → dispatch → CM6 update → panel.update()
  //  所有事件处理只做一件事：dispatch CM6 命令/effect
  //  计数更新完全由 panel.update() 的数据驱动逻辑处理
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  function dispatchQuery() {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: searchInput.value,
          caseSensitive,
          regexp,
          wholeWord,
          replace: replaceInput.value,
        })
      ),
    });
  }

  searchInput.addEventListener('input', dispatchQuery);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  replaceInput.addEventListener('input', dispatchQuery);
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      replaceNext(view);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  prevBtn.addEventListener('click', () => findPrevious(view));
  nextBtn.addEventListener('click', () => findNext(view));
  closeBtn.addEventListener('click', () => {
    closeSearchPanel(view);
    view.focus();
  });
  replaceBtn.addEventListener('click', () => replaceNext(view));
  replaceAllBtn.addEventListener('click', () => replaceAll(view));

  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle('cm-sp-toggle-active', caseSensitive);
    dispatchQuery();
  });
  wordBtn.addEventListener('click', () => {
    wholeWord = !wholeWord;
    wordBtn.classList.toggle('cm-sp-toggle-active', wholeWord);
    dispatchQuery();
  });
  regexBtn.addEventListener('click', () => {
    regexp = !regexp;
    regexBtn.classList.toggle('cm-sp-toggle-active', regexp);
    dispatchQuery();
  });

  expandBtn.addEventListener('click', () => {
    showReplace = !showReplace;
    expandBtn.classList.toggle('cm-sp-expand-active', showReplace);
    expandBtn.textContent = showReplace ? '▾' : '▸';
    replaceRow.classList.toggle('cm-sp-hidden', !showReplace);
    if (showReplace) replaceInput.focus();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Panel 生命周期
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return {
    dom,
    top: true,

    mount() {
      searchInput.focus();
      searchInput.select();
      fullRecompute();
    },

    update(update) {
      const q = getSearchQuery(update.state);
      const fp = queryFingerprint(q);

      if (fp !== lastFingerprint || update.docChanged) {
        // 查询或文档变化 → rAF 去抖全量重算
        lastFingerprint = fp;
        scheduleRecompute();
      } else if (update.selectionSet) {
        // 仅选区变化 → 二分查找更新 current index
        updateCurrentIndex();
      }

      // 外部 setSearchQuery 效果 → 同步输入框
      for (const tr of update.transactions) {
        for (const e of tr.effects) {
          if (e.is(setSearchQuery)) {
            const eq = e.value as SearchQuery;
            if (eq.search !== searchInput.value) searchInput.value = eq.search;
            if (eq.replace !== replaceInput.value) replaceInput.value = eq.replace;
            syncToggles(eq);
          }
        }
      }
    },

    destroy() {
      cancelAnimationFrame(rafId);
    },
  };
}

// ─── 搜索面板主题 ───────────────────────────────────────────────────────
export const searchPanelTheme = EditorView.theme(
  {
    '.cm-sp-panel': {
      padding: '6px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      backgroundColor: '#252526',
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      fontSize: '13px',
    },
    '.cm-sp-find-row': {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    },
    '.cm-sp-replace-row': {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      paddingLeft: '26px', // 与搜索输入对齐（expand 按钮宽度）
    },
    '.cm-sp-hidden': {
      display: 'none !important',
    },
    '.cm-sp-input': {
      flex: '1 1 160px',
      minWidth: '0',
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
      border: '1px solid #383838',
      borderRadius: '4px',
      padding: '4px 8px',
      height: '26px',
      boxSizing: 'border-box',
      fontSize: '13px',
      outline: 'none',
      fontFamily: "'Fira Code', 'Monaco', 'Menlo', monospace",
      transition: 'border-color 0.15s, box-shadow 0.15s',
    },
    '.cm-sp-input:focus': {
      borderColor: '#007acc',
      boxShadow: '0 0 0 1px rgba(0, 122, 204, 0.2)',
    },
    '.cm-sp-input::placeholder': {
      color: '#555',
    },
    // ── 功能开关按钮 ──
    '.cm-sp-toggle': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      padding: '0',
      backgroundColor: 'transparent',
      color: '#666',
      border: '1px solid transparent',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.12s ease',
      flexShrink: '0',
    },
    '.cm-sp-toggle:hover': {
      color: '#d4d4d4',
      backgroundColor: 'rgba(255, 255, 255, 0.06)',
    },
    '.cm-sp-toggle-active': {
      color: '#fff',
      backgroundColor: 'rgba(0, 122, 204, 0.3)',
      borderColor: 'rgba(0, 122, 204, 0.5)',
    },
    // ── 匹配计数 ──
    '.cm-sp-match-info': {
      fontSize: '12px',
      color: '#888',
      whiteSpace: 'nowrap',
      padding: '0 6px',
      flexShrink: '0',
      minWidth: '50px',
      textAlign: 'center',
    },
    '.cm-sp-no-match': {
      color: '#f44747',
    },
    // ── 导航按钮 ──
    '.cm-sp-nav-btn': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      padding: '0',
      backgroundColor: 'transparent',
      color: '#999',
      border: '1px solid transparent',
      borderRadius: '4px',
      fontSize: '14px',
      cursor: 'pointer',
      transition: 'all 0.12s ease',
      flexShrink: '0',
    },
    '.cm-sp-nav-btn:hover': {
      color: '#d4d4d4',
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    '.cm-sp-nav-btn:active': {
      transform: 'scale(0.92)',
    },
    // ── 关闭按钮 ──
    '.cm-sp-close-btn': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      padding: '0',
      marginLeft: '2px',
      backgroundColor: 'transparent',
      color: '#666',
      border: 'none',
      borderRadius: '4px',
      fontSize: '14px',
      cursor: 'pointer',
      transition: 'all 0.12s ease',
      flexShrink: '0',
    },
    '.cm-sp-close-btn:hover': {
      color: '#d4d4d4',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    // ── 展开按钮 ──
    '.cm-sp-expand-btn': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '22px',
      height: '26px',
      padding: '0',
      backgroundColor: 'transparent',
      color: '#888',
      border: 'none',
      borderRadius: '4px',
      fontSize: '12px',
      cursor: 'pointer',
      transition: 'all 0.12s ease',
      flexShrink: '0',
    },
    '.cm-sp-expand-btn:hover': {
      color: '#d4d4d4',
    },
    // ── 替换按钮 ──
    '.cm-sp-replace-btn': {
      backgroundColor: 'rgba(0, 122, 204, 0.12)',
      color: '#569cd6',
      border: '1px solid rgba(0, 122, 204, 0.15)',
      borderRadius: '4px',
      padding: '3px 10px',
      height: '26px',
      boxSizing: 'border-box',
      fontSize: '12px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'all 0.12s ease',
      flexShrink: '0',
    },
    '.cm-sp-replace-btn:hover': {
      backgroundColor: 'rgba(0, 122, 204, 0.22)',
      borderColor: 'rgba(0, 122, 204, 0.3)',
      color: '#7bb8e8',
    },
    '.cm-sp-replace-btn:active': {
      backgroundColor: 'rgba(0, 122, 204, 0.3)',
    },
    // ── 匹配高亮 ──
    '.cm-searchMatch': {
      backgroundColor: 'rgba(255, 200, 0, 0.15)',
      outline: '1px solid rgba(255, 200, 0, 0.3)',
      borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(255, 150, 0, 0.28)',
      outline: '1px solid rgba(255, 150, 0, 0.5)',
    },
  },
  { dark: true }
);

// ─── 公共 API ───────────────────────────────────────────────────────────
// 将所有搜索相关 extension 封装为单一入口，方便复用
// 消费方只需: [...searchExtensions(), keymap.of([...searchKeymap])]
export function searchExtensions(): Extension[] {
  return [search({ top: true, createPanel: createSearchPanel }), searchPanelTheme];
}
