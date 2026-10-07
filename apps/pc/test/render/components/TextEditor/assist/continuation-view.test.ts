// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, historyKeymap, undo } from '@codemirror/commands';
import {
  acceptContinuation,
  continuationExtension,
  continuationKeyCommand,
  dismissContinuation,
  getContinuationState,
  nextContinuation,
  requestContinuation,
  subscribeContinuation,
} from '@/render/components/TextEditor/assist/continuation';
import type {
  ContinuationHandlers,
  ContinuationRequest,
  ContinuationService,
  EditorAssistConfig,
} from '@/render/components/TextEditor/assist/types';

interface FakeCall {
  request: ContinuationRequest;
  handlers: ContinuationHandlers;
  cancel: ReturnType<typeof vi.fn>;
}

function fakeService() {
  const calls: FakeCall[] = [];
  const service: ContinuationService = {
    start: (request, handlers) => {
      const cancel = vi.fn();
      calls.push({ request, handlers, cancel });
      return cancel;
    },
  };
  return { service, calls };
}

let view: EditorView | null = null;

function mount(doc: string, config: Partial<EditorAssistConfig> = {}, readOnly = false) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        history(),
        keymap.of(historyKeymap),
        EditorView.editable.of(!readOnly),
        continuationExtension(() => ({
          config: { characters: [], ...config },
          filePath: '/书/001-启程.md',
          readOnly,
        })),
      ],
    }),
    parent,
  });
  return view;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const widgetText = (v: EditorView) =>
  v.dom.querySelector('[data-testid="continuation-widget"]')?.textContent ?? null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
});

describe('行内续写（CodeMirror）', () => {
  it('请求 → 流式片段 → Tab 采纳为单独一步撤销', async () => {
    const { service, calls } = fakeService();
    const v = mount('林舟拔剑。', { continuation: service });
    expect(requestContinuation(v)).toBe(true);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].request).toMatchObject({
      docText: '林舟拔剑。',
      cursor: 5,
      filePath: '/书/001-启程.md',
      options: { length: 'sentence', direction: 'continue' },
    });
    expect(widgetText(v)).toContain('续写中');

    calls[0].handlers.onText('雾气');
    calls[0].handlers.onText('雾气翻涌。');
    expect(widgetText(v)).toContain('雾气翻涌。');
    // 续写不进入文档
    expect(v.state.doc.toString()).toBe('林舟拔剑。');
    calls[0].handlers.onDone();
    expect(getContinuationState(v.state).phase).toBe('ready');
    expect(widgetText(v)).toContain('Tab 采纳');

    expect(acceptContinuation(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('林舟拔剑。雾气翻涌。');
    expect(v.state.selection.main.head).toBe(v.state.doc.length);
    expect(getContinuationState(v.state).phase).toBe('idle');
    expect(widgetText(v)).toBeNull();

    undo(v);
    expect(v.state.doc.toString()).toBe('林舟拔剑。');
  });

  it('Esc 放弃：文档不变并取消流', async () => {
    const { service, calls } = fakeService();
    const v = mount('开头', { continuation: service });
    requestContinuation(v);
    await flush();
    calls[0].handlers.onText('一段');
    expect(dismissContinuation(v)).toBe(true);
    expect(calls[0].cancel).toHaveBeenCalledOnce();
    expect(v.state.doc.toString()).toBe('开头');
    expect(dismissContinuation(v)).toBe(false);
    // 取消后迟到的片段被忽略
    calls[0].handlers.onText('迟到');
    expect(getContinuationState(v.state).phase).toBe('idle');
  });

  it('用户在别处输入或移动光标即取消', async () => {
    const { service, calls } = fakeService();
    const v = mount('开头结尾', { continuation: service });
    requestContinuation(v);
    await flush();
    v.dispatch({ changes: { from: 0, insert: '新' }, userEvent: 'input.type' });
    expect(calls[0].cancel).toHaveBeenCalledOnce();
    expect(getContinuationState(v.state).phase).toBe('idle');

    requestContinuation(v);
    await flush();
    v.dispatch({ selection: { anchor: 0 } });
    expect(calls[1].cancel).toHaveBeenCalledOnce();
    expect(getContinuationState(v.state).phase).toBe('idle');
  });

  it('⌥] 换一个：取消当前流并发起新请求，版本计数显示在提示里', async () => {
    const { service, calls } = fakeService();
    const v = mount('开头', { continuation: service });
    requestContinuation(v);
    await flush();
    calls[0].handlers.onText('版本一');
    calls[0].handlers.onDone();
    expect(nextContinuation(v)).toBe(true);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1].handlers.onText('版本二');
    calls[1].handlers.onDone();
    expect(getContinuationState(v.state).variants).toEqual(['版本一', '版本二']);
    expect(widgetText(v)).toContain('2/2');
  });

  it('没有续写服务 / 服务报错时显示友好提示，可去设置', async () => {
    const openAiSettings = vi.fn();
    const v = mount('开头', { openAiSettings });
    requestContinuation(v);
    await flush();
    expect(getContinuationState(v.state).error?.kind).toBe('not-configured');
    expect(widgetText(v)).toContain('AI 还没有配置');
    const settings = Array.from(v.dom.querySelectorAll('button')).find(
      (item) => item.textContent === '去设置'
    );
    settings?.click();
    expect(openAiSettings).toHaveBeenCalledOnce();
    expect(getContinuationState(v.state).phase).toBe('idle');
  });

  it('网络错误可重试；建议模式带采纳 / 放弃按钮', async () => {
    const { service, calls } = fakeService();
    const v = mount('开头', { continuation: service });
    requestContinuation(v, {
      mode: 'suggestion',
      options: { length: 'paragraph', direction: 'conflict', followOutline: false },
    });
    await flush();
    calls[0].handlers.onError({ kind: 'network', message: 'fetch failed', retryable: true });
    expect(widgetText(v)).toContain('网络连接失败');
    const retry = Array.from(v.dom.querySelectorAll('button')).find(
      (item) => item.textContent === '重试'
    );
    retry?.click();
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].request.options.direction).toBe('conflict');
    calls[1].handlers.onText('冲突来了。');
    calls[1].handlers.onDone();
    const labels = Array.from(v.dom.querySelectorAll('button')).map((item) => item.textContent);
    expect(labels).toEqual(expect.arrayContaining(['采纳', '放弃']));
    Array.from(v.dom.querySelectorAll('button'))
      .find((item) => item.textContent === '采纳')
      ?.click();
    expect(v.state.doc.toString()).toBe('开头冲突来了。');
  });

  it('只读文件不发起；订阅者收到状态变化', async () => {
    const { service } = fakeService();
    const ro = mount('只读', { continuation: service }, true);
    expect(requestContinuation(ro)).toBe(false);
    ro.destroy();

    const v = mount('开头', { continuation: service });
    const seen: string[] = [];
    const unsubscribe = subscribeContinuation(v, (state) => seen.push(state.phase));
    requestContinuation(v);
    dismissContinuation(v);
    unsubscribe();
    requestContinuation(v);
    expect(seen).toEqual(['loading', 'idle']);
  });

  it('⌥/Alt + \\ 与 ⌥/Alt + ] 按物理键位匹配（macOS Option 组合输出 « / ‘）', () => {
    const base = {
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      isComposing: false,
    };
    // macOS 真实按键：key 是 Option 输出的字符，keyCode/code 才是物理键
    expect(continuationKeyCommand({ ...base, key: '«', code: 'Backslash' })).toBe('request');
    expect(continuationKeyCommand({ ...base, key: '‘', code: 'BracketRight' })).toBe('next');
    // Windows / Linux
    expect(continuationKeyCommand({ ...base, key: '\\', code: 'Backslash' })).toBe('request');
    expect(continuationKeyCommand({ ...base, key: ']', code: 'BracketRight' })).toBe('next');
    // 其他修饰键 / 组字中 / 无 Alt 不触发
    expect(
      continuationKeyCommand({ ...base, key: '\\', code: 'Backslash', metaKey: true })
    ).toBeNull();
    expect(
      continuationKeyCommand({ ...base, key: '\\', code: 'Backslash', shiftKey: true })
    ).toBeNull();
    expect(
      continuationKeyCommand({ ...base, key: '«', code: 'Backslash', isComposing: true })
    ).toBeNull();
    expect(
      continuationKeyCommand({ ...base, key: '\\', code: 'Backslash', altKey: false })
    ).toBeNull();
    expect(continuationKeyCommand({ ...base, key: 'a', code: 'KeyA' })).toBeNull();
  });

  it('macOS 上 ⌥\\ 的真实 keydown（key = «）发起续写且不输入字符；没有续写时 ⌥] 放行', async () => {
    const { service, calls } = fakeService();
    const v = mount('开头', { continuation: service });
    const press = (key: string, code: string, keyCode: number) => {
      const event = new KeyboardEvent('keydown', {
        key,
        code,
        keyCode,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      v.contentDOM.dispatchEvent(event);
      return event;
    };
    // 空闲时 ⌥] 没有可换的版本：不拦截，保留 macOS 输入「‘」的能力
    expect(press('‘', 'BracketRight', 221).defaultPrevented).toBe(false);
    expect(press('«', 'Backslash', 220).defaultPrevented).toBe(true);
    await flush();
    expect(calls).toHaveLength(1);
    expect(getContinuationState(v.state).phase).toBe('loading');
    expect(v.state.doc.toString()).toBe('开头');
    calls[0].handlers.onText('版本一');
    calls[0].handlers.onDone();
    expect(press('‘', 'BracketRight', 221).defaultPrevented).toBe(true);
    await flush();
    expect(calls).toHaveLength(2);
  });
});
