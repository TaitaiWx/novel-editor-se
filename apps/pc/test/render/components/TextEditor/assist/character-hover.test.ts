// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  HIGHLIGHT_ALL_MS,
  characterHoverExtension,
  closeCharacterCards,
  highlightAllField,
  isTypingRecently,
  matcherFor,
  openCharacterCardAtCursor,
} from '@/render/components/TextEditor/assist/character-hover';
import type {
  CharacterCardActions,
  EditorAssistContext,
} from '@/render/components/TextEditor/assist/types';

const CHARACTERS = [
  { id: 1, name: '林舟', aliases: ['阿舟'] },
  { id: 2, name: '苏晴', aliases: [] },
];

let view: EditorView | null = null;

function mount(doc: string, cursor: number) {
  const rendered: Array<{ id: number; actions: CharacterCardActions }> = [];
  const cleanup = vi.fn();
  const context: EditorAssistContext = {
    config: {
      characters: CHARACTERS,
      renderCharacterCard: (dom, id, actions) => {
        dom.textContent = `card-${id}`;
        rendered.push({ id, actions });
        return cleanup;
      },
    },
    filePath: null,
    readOnly: false,
  };
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [characterHoverExtension(() => context)],
    }),
    parent,
  });
  return { view, rendered, cleanup };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
});

describe('人物悬停卡片（CodeMirror）', () => {
  it('⌘K：光标在人名上时打开卡片，Esc 关闭；光标不在人名上不处理', async () => {
    const { view: v, rendered, cleanup } = mount('阿舟与苏晴同行', 1);
    expect(
      openCharacterCardAtCursor(v, () => ({ config: null, filePath: null, readOnly: false }))
    ).toBe(false);
    const getContext = () => ({
      config: {
        characters: CHARACTERS,
        renderCharacterCard: (dom: HTMLElement, id: number, actions: CharacterCardActions) => {
          dom.textContent = `card-${id}`;
          rendered.push({ id, actions });
          return cleanup;
        },
      },
      filePath: null,
      readOnly: false,
    });
    expect(openCharacterCardAtCursor(v, getContext)).toBe(true);
    await flush();
    expect(v.dom.querySelector('.cm-character-card-host')?.textContent).toBe('card-1');
    expect(rendered.at(-1)?.id).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(v.dom.querySelector('.cm-character-card-host')).toBeNull();
    expect(cleanup).toHaveBeenCalled();
    expect(closeCharacterCards(v)).toBe(false);

    v.dispatch({ selection: { anchor: 7 } });
    expect(openCharacterCardAtCursor(v, getContext)).toBe(false);
  });

  it('光标移出人名或编辑文档时，⌘K 打开的卡片自动关闭', async () => {
    const { view: v } = mount('林舟说话', 1);
    const getContext = () => ({
      config: { characters: CHARACTERS, renderCharacterCard: () => () => undefined },
      filePath: null,
      readOnly: false,
    });
    openCharacterCardAtCursor(v, getContext);
    await flush();
    expect(v.dom.querySelector('.cm-character-card-host')).not.toBeNull();
    v.dispatch({ selection: { anchor: 4 } });
    await flush();
    expect(v.dom.querySelector('.cm-character-card-host')).toBeNull();
  });

  it('高亮全部：只装饰可见区域内该人物的出现，8 秒后自动清除', async () => {
    vi.useFakeTimers();
    const { view: v, rendered } = mount('林舟见到苏晴，阿舟笑了。', 1);
    const getContext = () => ({
      config: { characters: CHARACTERS },
      filePath: null,
      readOnly: false,
    });
    // ⌘K 识别用传入的上下文，卡片内容由扩展自己的上下文渲染
    expect(openCharacterCardAtCursor(v, getContext)).toBe(false);
    v.dispatch({ effects: [] });
    expect(
      openCharacterCardAtCursor(v, () => ({
        config: { characters: CHARACTERS, renderCharacterCard: () => () => undefined },
        filePath: null,
        readOnly: false,
      }))
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    // 卡片按钮「高亮全部」：同时关闭卡片
    rendered.at(-1)?.actions.highlightAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(v.dom.querySelector('.cm-character-card-host')).toBeNull();
    expect(v.state.field(highlightAllField)).toBe(1);
    const marks = Array.from(v.dom.querySelectorAll('.cm-character-highlight-all')).map(
      (el) => el.textContent
    );
    expect(marks).toEqual(['林舟', '阿舟']);
    await vi.advanceTimersByTimeAsync(HIGHLIGHT_ALL_MS + 10);
    expect(v.state.field(highlightAllField)).toBeNull();
    expect(v.dom.querySelector('.cm-character-highlight-all')).toBeNull();
  });

  it('刚输入完不弹卡片；同一份人物列表复用识别器', () => {
    const { view: v } = mount('林舟', 2);
    expect(isTypingRecently(v)).toBe(false);
    v.dispatch({ changes: { from: 2, insert: '。' }, userEvent: 'input.type' });
    expect(isTypingRecently(v)).toBe(true);
    expect(isTypingRecently(v, Date.now() + 2000)).toBe(false);
    expect(matcherFor(CHARACTERS)).toBe(matcherFor(CHARACTERS));
    expect(matcherFor([...CHARACTERS])).not.toBe(matcherFor(CHARACTERS));
  });
});
