// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import { searchExtensions } from '@/render/components/TextEditor/search-panel';

// rAF 手动冲刷，保证匹配计数可确定性地断言
let rafQueue: Array<FrameRequestCallback> = [];
const flushRaf = () => {
  const queue = rafQueue;
  rafQueue = [];
  queue.forEach((cb) => cb(0));
};

let view: EditorView | null = null;

function createView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({
    state: EditorState.create({ doc, extensions: searchExtensions() }),
    parent,
  });
  return view;
}

function openPanel(v: EditorView) {
  openSearchPanel(v);
  flushRaf();
  const panel = v.dom.querySelector('.cm-sp-panel') as HTMLElement;
  expect(panel).toBeTruthy();
  const q = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
  return {
    panel,
    searchInput: q<HTMLInputElement>('input[name="search"]'),
    replaceInput: q<HTMLInputElement>('input[name="replace"]'),
    caseBtn: q<HTMLButtonElement>('button[title="区分大小写"]'),
    wordBtn: q<HTMLButtonElement>('button[title="全字匹配"]'),
    regexBtn: q<HTMLButtonElement>('button[title="正则表达式"]'),
    prevBtn: q<HTMLButtonElement>('button[title^="上一个"]'),
    nextBtn: q<HTMLButtonElement>('button[title^="下一个"]'),
    closeBtn: q<HTMLButtonElement>('button[name="close"]'),
    replaceBtn: q<HTMLButtonElement>('button[name="replace"]'),
    replaceAllBtn: q<HTMLButtonElement>('button[name="replaceAll"]'),
    expandBtn: q<HTMLButtonElement>('button[title="切换替换"]'),
    replaceRow: q<HTMLElement>('.cm-sp-replace-row'),
    matchInfo: q<HTMLElement>('.cm-sp-match-info'),
  };
}

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushRaf();
}

function keydown(input: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  );
  flushRaf();
}

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('TextEditor search-panel', () => {
  it('searchExtensions 返回 search 扩展 + 主题', () => {
    expect(searchExtensions()).toHaveLength(2);
  });

  it('打开面板后渲染全部控件，空查询时不显示计数', () => {
    const v = createView('hello world');
    const els = openPanel(v);
    expect(searchPanelOpen(v.state)).toBe(true);
    expect(els.searchInput.value).toBe('');
    expect(els.matchInfo.textContent).toBe('');
    expect(els.replaceRow.classList.contains('cm-sp-hidden')).toBe(true);
    expect(els.expandBtn.textContent).toBe('▸');
  });

  it('输入查询后显示总数，无匹配显示"无结果"', () => {
    const v = createView('foo bar foo baz foo');
    const els = openPanel(v);
    typeInto(els.searchInput, 'foo');
    expect(getSearchQuery(v.state).search).toBe('foo');
    expect(els.matchInfo.textContent).toBe('3 个结果');

    typeInto(els.searchInput, 'zzz');
    expect(els.matchInfo.textContent).toBe('无结果');
    expect(els.matchInfo.className).toContain('cm-sp-no-match');
  });

  it('Enter / 下一个按钮跳到下一个匹配，并显示当前序号', () => {
    const v = createView('foo bar foo baz foo');
    const els = openPanel(v);
    typeInto(els.searchInput, 'foo');

    keydown(els.searchInput, 'Enter');
    const first = v.state.selection.main;
    expect(v.state.sliceDoc(first.from, first.to)).toBe('foo');
    expect(els.matchInfo.textContent).toMatch(/^\d\/3$/);

    const before = els.matchInfo.textContent;
    els.nextBtn.click();
    flushRaf();
    expect(els.matchInfo.textContent).toMatch(/^\d\/3$/);
    expect(els.matchInfo.textContent).not.toBe(before);

    els.prevBtn.click();
    flushRaf();
    expect(els.matchInfo.textContent).toBe(before);

    keydown(els.searchInput, 'Enter', { shiftKey: true });
    expect(els.matchInfo.textContent).toMatch(/^\d\/3$/);
  });

  it('IME 组字中的 Enter 不触发跳转', () => {
    const v = createView('foo foo');
    const els = openPanel(v);
    typeInto(els.searchInput, 'foo');
    const sel = v.state.selection.main;
    keydown(els.searchInput, 'Enter', { isComposing: true });
    keydown(els.replaceInput, 'Enter', { isComposing: true });
    expect(v.state.selection.main.from).toBe(sel.from);
    expect(v.state.doc.toString()).toBe('foo foo');
  });

  it('大小写 / 全字 / 正则 开关切换并影响计数', () => {
    const v = createView('Foo foo food');
    const els = openPanel(v);
    typeInto(els.searchInput, 'foo');
    expect(els.matchInfo.textContent).toBe('3 个结果');

    els.caseBtn.click();
    flushRaf();
    expect(els.caseBtn.classList.contains('cm-sp-toggle-active')).toBe(true);
    expect(getSearchQuery(v.state).caseSensitive).toBe(true);
    expect(els.matchInfo.textContent).toBe('2 个结果');

    els.wordBtn.click();
    flushRaf();
    expect(els.wordBtn.classList.contains('cm-sp-toggle-active')).toBe(true);
    expect(els.matchInfo.textContent).toBe('1 个结果');

    els.wordBtn.click();
    els.caseBtn.click();
    els.regexBtn.click();
    flushRaf();
    expect(els.regexBtn.classList.contains('cm-sp-toggle-active')).toBe(true);
    typeInto(els.searchInput, 'fo+d?');
    expect(getSearchQuery(v.state).regexp).toBe(true);
    expect(els.matchInfo.textContent).toBe('3 个结果');

    // 非法正则 → 查询无效 → 无结果
    typeInto(els.searchInput, '(');
    expect(els.matchInfo.textContent).toBe('无结果');
  });

  it('展开替换行并执行 替换 / 全部替换 / Enter 替换', () => {
    const v = createView('a a a a');
    const els = openPanel(v);
    els.expandBtn.click();
    expect(els.replaceRow.classList.contains('cm-sp-hidden')).toBe(false);
    expect(els.expandBtn.textContent).toBe('▾');

    typeInto(els.searchInput, 'a');
    typeInto(els.replaceInput, 'b');
    expect(getSearchQuery(v.state).replace).toBe('b');

    els.replaceBtn.click();
    flushRaf();
    expect(v.state.doc.toString()).toMatch(/^[ab]( [ab]){3}$/);

    keydown(els.replaceInput, 'Enter');
    els.replaceAllBtn.click();
    flushRaf();
    expect(v.state.doc.toString()).toBe('b b b b');
    expect(els.matchInfo.textContent).toBe('无结果');

    els.expandBtn.click();
    expect(els.replaceRow.classList.contains('cm-sp-hidden')).toBe(true);
    expect(els.expandBtn.textContent).toBe('▸');
  });

  it('外部 setSearchQuery 同步到输入框与开关', () => {
    const v = createView('Abc abc');
    const els = openPanel(v);
    v.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: 'abc', replace: 'x', caseSensitive: true, regexp: true })
      ),
    });
    flushRaf();
    expect(els.searchInput.value).toBe('abc');
    expect(els.replaceInput.value).toBe('x');
    expect(els.caseBtn.classList.contains('cm-sp-toggle-active')).toBe(true);
    expect(els.regexBtn.classList.contains('cm-sp-toggle-active')).toBe(true);
    expect(els.matchInfo.textContent).toBe('1 个结果');

    // 仅选区变化 → 走二分查找路径
    v.dispatch({ selection: { anchor: 4, head: 7 } });
    expect(els.matchInfo.textContent).toBe('1/1');
    v.dispatch({ selection: { anchor: 0 } });
    expect(els.matchInfo.textContent).toBe('1 个结果');
  });

  it('已有 replace 的查询打开时默认展开替换行', () => {
    const v = createView('abc');
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'b', replace: 'z' })) });
    const els = openPanel(v);
    expect(els.searchInput.value).toBe('b');
    expect(els.replaceInput.value).toBe('z');
    expect(els.replaceRow.classList.contains('cm-sp-hidden')).toBe(false);
    expect(els.matchInfo.textContent).toBe('1 个结果');
  });

  it('文档变化触发重新计数', () => {
    const v = createView('x');
    const els = openPanel(v);
    typeInto(els.searchInput, 'x');
    expect(els.matchInfo.textContent).toBe('1 个结果');
    v.dispatch({ changes: { from: 1, insert: ' x x' } });
    flushRaf();
    expect(els.matchInfo.textContent).toBe('3 个结果');
  });

  it('超过 10000 个匹配时显示溢出提示', () => {
    const v = createView('a'.repeat(10_050));
    const els = openPanel(v);
    typeInto(els.searchInput, 'a');
    expect(els.matchInfo.textContent).toBe('10000+ 个结果');
    v.dispatch({ selection: { anchor: 0, head: 1 } });
    expect(els.matchInfo.textContent).toBe('1/10000+');
  });

  it('Escape / 关闭按钮关闭面板', () => {
    const v = createView('abc');
    let els = openPanel(v);
    keydown(els.searchInput, 'Escape');
    expect(searchPanelOpen(v.state)).toBe(false);

    els = openPanel(v);
    keydown(els.replaceInput, 'Escape');
    expect(searchPanelOpen(v.state)).toBe(false);

    els = openPanel(v);
    els.closeBtn.click();
    expect(searchPanelOpen(v.state)).toBe(false);
  });

  // BUG: search-panel.ts 中 `let wholeWord = false;` 未从已有查询初始化，
  // 且 syncToggles 不同步 wholeWord —— 外部/之前设置的全字匹配状态在面板上丢失，
  // 下一次输入 dispatchQuery 会把 wholeWord 静默重置为 false。
  it('打开面板时应反映已有查询的 wholeWord 状态', () => {
    const v = createView('foo food');
    v.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: 'foo', wholeWord: true })),
    });
    const els = openPanel(v);
    expect(els.wordBtn.classList.contains('cm-sp-toggle-active')).toBe(true);
  });
});
