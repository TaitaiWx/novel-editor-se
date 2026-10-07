/**
 * 续写的 CodeMirror 部分：状态字段、幽灵文字 / 建议 widget、流式请求控制器、快捷键与命令
 *
 * - ⌥/Alt + \ 在光标处请求行内续写（幽灵文字）；续写面板以「建议」模式发起，样式更醒目并带按钮
 * - Tab 采纳（单独一步撤销）、Esc 放弃、⌥/Alt + ] 换一个版本；从不自动触发
 * - 续写内容在采纳前不进入文档：放弃即恢复原样，自动保存与写作统计只看到采纳后的正文
 * - 用户在别处输入或移动光标即取消（同时中止流式请求）
 */
import { isolateHistory } from '@codemirror/commands';
import {
  Annotation,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  IDLE_CONTINUATION,
  canAcceptContinuation,
  currentContinuationText,
  planNextVariant,
  reduceContinuation,
  type ContinuationAction,
  type ContinuationState,
} from './continuation-state';
import { describeAIError } from './ai-error';
import type { ContinuationMode, ContinuationOptions, GetAssistContext } from './types';

export const continuationAction = StateEffect.define<ContinuationAction>();
const acceptedAnnotation = Annotation.define<boolean>();

export const DEFAULT_GHOST_OPTIONS: ContinuationOptions = {
  length: 'sentence',
  direction: 'continue',
  followOutline: true,
};

let requestCounter = 0;
const nextRequestId = () => (requestCounter += 1);

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
const ALT = IS_MAC ? '⌥' : 'Alt+';

// ─── 状态字段 ────────────────────────────────────────────────────────────────

export const continuationField = StateField.define<ContinuationState>({
  create: () => IDLE_CONTINUATION,
  update(value, tr) {
    let next = value;
    let requested = false;
    for (const effect of tr.effects) {
      if (!effect.is(continuationAction)) continue;
      if (effect.value.type === 'request') requested = true;
      next = reduceContinuation(next, effect.value);
    }
    if (next.phase === 'idle') return next;
    // 采纳之外的任何文档变化（用户继续输入、粘贴、外部重载）都放弃本次续写
    if (tr.docChanged && !requested) {
      return tr.annotation(acceptedAnnotation) ? next : IDLE_CONTINUATION;
    }
    if (tr.selection && !requested && tr.state.selection.main.head !== next.anchor) {
      return IDLE_CONTINUATION;
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state): DecorationSet => {
      const value = state.field(field);
      if (value.phase === 'idle' || value.anchor > state.doc.length) return Decoration.none;
      return Decoration.set([
        Decoration.widget({ widget: new ContinuationWidget(value), side: 1 }).range(value.anchor),
      ]);
    }),
});

export function getContinuationState(state: EditorState): ContinuationState {
  return state.field(continuationField, false) ?? IDLE_CONTINUATION;
}

// ─── 命令 ────────────────────────────────────────────────────────────────────

export interface RequestContinuationInput {
  mode: ContinuationMode;
  options?: ContinuationOptions;
}

/** 在光标处发起续写；只读或未安装续写扩展时返回 false */
export function requestContinuation(
  view: EditorView,
  input: RequestContinuationInput = { mode: 'ghost' }
): boolean {
  if (!view.state.field(continuationField, false) || !view.state.facet(EditorView.editable)) {
    return false;
  }
  view.dispatch({
    effects: continuationAction.of({
      type: 'request',
      requestId: nextRequestId(),
      anchor: view.state.selection.main.head,
      mode: input.mode,
      options: input.options ?? DEFAULT_GHOST_OPTIONS,
    }),
  });
  return true;
}

/** 采纳：一次性插入，单独一步撤销 */
export function acceptContinuation(view: EditorView): boolean {
  const state = getContinuationState(view.state);
  if (!canAcceptContinuation(state)) return false;
  const text = currentContinuationText(state);
  view.dispatch({
    changes: { from: state.anchor, insert: text },
    selection: { anchor: state.anchor + text.length },
    effects: continuationAction.of({ type: 'clear' }),
    annotations: [
      acceptedAnnotation.of(true),
      Transaction.userEvent.of('input.complete'),
      isolateHistory.of('full'),
    ],
    scrollIntoView: true,
  });
  return true;
}

export function dismissContinuation(view: EditorView): boolean {
  if (getContinuationState(view.state).phase === 'idle') return false;
  view.dispatch({ effects: continuationAction.of({ type: 'clear' }) });
  return true;
}

/** ⌥]：换一个版本（未满 3 个时重新请求，满了在已有版本间轮换） */
export function nextContinuation(view: EditorView): boolean {
  const state = getContinuationState(view.state);
  const plan = planNextVariant(state);
  if (plan === 'none') return state.phase !== 'idle';
  view.dispatch({
    effects: continuationAction.of(
      plan === 'cycle'
        ? { type: 'cycle' }
        : { type: 'next', requestId: nextRequestId(), replace: state.phase !== 'ready' }
    ),
  });
  return true;
}

/** 出错后重试（替换失败的版本） */
export function retryContinuation(view: EditorView): boolean {
  const state = getContinuationState(view.state);
  if (state.phase === 'idle') return false;
  view.dispatch({
    effects: continuationAction.of({ type: 'next', requestId: nextRequestId(), replace: true }),
  });
  return true;
}

// ─── 订阅（续写面板显示进度与上下文） ────────────────────────────────────────

type ContinuationListener = (state: ContinuationState) => void;
const listeners = new WeakMap<EditorView, Set<ContinuationListener>>();

export function subscribeContinuation(view: EditorView, listener: ContinuationListener) {
  let set = listeners.get(view);
  if (!set) {
    set = new Set();
    listeners.set(view, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

// ─── widget ─────────────────────────────────────────────────────────────────

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'cm-continuation-button';
  el.textContent = label;
  el.title = title;
  el.addEventListener('mousedown', (event) => event.preventDefault());
  el.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return el;
}

class ContinuationWidget extends WidgetType {
  constructor(readonly state: ContinuationState) {
    super();
  }

  eq(other: ContinuationWidget): boolean {
    const a = this.state;
    const b = other.state;
    return (
      a.phase === b.phase &&
      a.mode === b.mode &&
      a.index === b.index &&
      a.variants.length === b.variants.length &&
      currentContinuationText(a) === currentContinuationText(b) &&
      a.error?.kind === b.error?.kind
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const { state } = this;
    const root = document.createElement('span');
    root.className = `cm-continuation cm-continuation-${state.mode} cm-continuation-${state.phase}`;
    root.setAttribute('data-testid', 'continuation-widget');
    root.setAttribute('aria-live', 'polite');

    const text = currentContinuationText(state);
    if (text) {
      const body = document.createElement('span');
      body.className = 'cm-continuation-text';
      body.textContent = text;
      root.appendChild(body);
    }

    const meta = document.createElement('span');
    meta.className = 'cm-continuation-meta';
    root.appendChild(meta);
    if (state.phase === 'loading' || state.phase === 'streaming') {
      const label = document.createElement('span');
      label.className = 'cm-continuation-status';
      label.textContent = state.phase === 'loading' ? '续写中…' : '…';
      meta.appendChild(label);
    }
    if (state.phase === 'error' && state.error) {
      const info = describeAIError(state.error);
      const label = document.createElement('span');
      label.className = 'cm-continuation-error';
      label.textContent = info.hint ? `${info.title}：${info.hint}` : info.title;
      meta.appendChild(label);
      if (info.canRetry)
        meta.appendChild(button('重试', '重新续写', () => retryContinuation(view)));
      if (info.needsSettings) {
        meta.appendChild(
          button('去设置', '打开设置中心的 AI 服务', () => {
            dismissContinuation(view);
            openAiSettingsFor(view);
          })
        );
      }
      meta.appendChild(button('关闭', '关闭 (Esc)', () => dismissContinuation(view)));
      return root;
    }
    const filled = state.variants.filter((item) => item.trim()).length;
    const counter = filled > 1 ? ` ${state.index + 1}/${state.variants.length}` : '';
    if (state.mode === 'suggestion') {
      if (state.phase === 'ready' || state.phase === 'streaming') {
        meta.appendChild(button('采纳', '采纳建议 (Tab)', () => acceptContinuation(view)));
        meta.appendChild(button('放弃', '放弃建议 (Esc)', () => dismissContinuation(view)));
      }
      if (state.phase === 'ready') {
        meta.appendChild(
          button(`换一个${counter}`, `换一个版本 (${ALT}])`, () => nextContinuation(view))
        );
      }
    } else if (state.phase === 'ready') {
      const hint = document.createElement('span');
      hint.className = 'cm-continuation-hint';
      hint.textContent = `Tab 采纳 · Esc 放弃 · ${ALT}] 换一个${counter}`;
      meta.appendChild(hint);
    }
    return root;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ─── 控制器：按状态发起 / 取消流式请求 ────────────────────────────────────────

const openSettingsHandlers = new WeakMap<EditorView, () => void>();
function openAiSettingsFor(view: EditorView) {
  openSettingsHandlers.get(view)?.();
}

function createController(getContext: GetAssistContext) {
  return ViewPlugin.fromClass(
    class {
      private running: { requestId: number; cancel: () => void } | null = null;
      private destroyed = false;

      constructor(private readonly view: EditorView) {
        openSettingsHandlers.set(view, () => getContext().config?.openAiSettings?.());
      }

      update(update: ViewUpdate) {
        const prev = getContinuationState(update.startState);
        const next = getContinuationState(update.state);
        if (prev === next) return;
        if (this.running && (next.phase === 'idle' || next.requestId !== this.running.requestId)) {
          this.cancelRunning();
        }
        if (next.phase === 'loading' && this.running?.requestId !== next.requestId) {
          const requestId = next.requestId;
          // 不能在 update 中同步 dispatch：放到微任务里发起
          queueMicrotask(() => this.start(requestId));
        }
        listeners.get(this.view)?.forEach((listener) => listener(next));
      }

      private cancelRunning() {
        const running = this.running;
        this.running = null;
        running?.cancel();
      }

      private send(action: ContinuationAction) {
        if (this.destroyed) return;
        const current = getContinuationState(this.view.state);
        if ('requestId' in action && action.requestId !== current.requestId) return;
        this.view.dispatch({ effects: continuationAction.of(action) });
      }

      private start(requestId: number) {
        if (this.destroyed) return;
        const state = getContinuationState(this.view.state);
        if (state.phase !== 'loading' || state.requestId !== requestId || !state.options) return;
        if (this.running?.requestId === requestId) return;
        const context = getContext();
        const service = context.config?.continuation;
        if (!service) {
          this.send({
            type: 'error',
            requestId,
            error: { kind: 'not-configured', message: '还没有配置 AI 服务', retryable: false },
          });
          return;
        }
        let finished = false;
        const cancel = service.start(
          {
            docText: this.view.state.doc.toString(),
            cursor: state.anchor,
            filePath: context.filePath,
            options: state.options,
          },
          {
            onContext: (summary) => this.send({ type: 'context', requestId, context: summary }),
            onText: (text) => this.send({ type: 'chunk', requestId, text }),
            onDone: () => {
              finished = true;
              if (this.running?.requestId === requestId) this.running = null;
              this.send({ type: 'done', requestId });
            },
            onError: (error) => {
              finished = true;
              if (this.running?.requestId === requestId) this.running = null;
              this.send({ type: 'error', requestId, error });
            },
          }
        );
        if (!finished) this.running = { requestId, cancel };
      }

      destroy() {
        this.destroyed = true;
        this.cancelRunning();
        openSettingsHandlers.delete(this.view);
      }
    }
  );
}

// ─── 主题 ────────────────────────────────────────────────────────────────────

const continuationTheme = EditorView.baseTheme({
  '.cm-continuation': {
    whiteSpace: 'pre-wrap',
  },
  '.cm-continuation-ghost .cm-continuation-text': {
    color: 'rgba(212, 212, 212, 0.42)',
  },
  '.cm-continuation-suggestion .cm-continuation-text': {
    color: '#e6dcc1',
    backgroundColor: 'rgba(215, 186, 125, 0.12)',
    boxShadow: 'inset 0 -1px 0 rgba(215, 186, 125, 0.45)',
    borderRadius: '2px',
  },
  '.cm-continuation-meta': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    marginLeft: '6px',
    verticalAlign: 'baseline',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
    fontSize: '11px',
    whiteSpace: 'nowrap',
  },
  '.cm-continuation-meta:empty': { display: 'none' },
  '.cm-continuation-status, .cm-continuation-hint': {
    color: 'rgba(212, 212, 212, 0.45)',
  },
  '.cm-continuation-loading .cm-continuation-status': {
    animation: 'cm-continuation-pulse 1.2s ease-in-out infinite',
  },
  '@keyframes cm-continuation-pulse': {
    '0%, 100%': { opacity: 0.35 },
    '50%': { opacity: 0.9 },
  },
  '.cm-continuation-error': {
    color: '#e8a29a',
    whiteSpace: 'normal',
  },
  '.cm-continuation-button': {
    height: '20px',
    padding: '0 7px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '4px',
    background: 'rgba(255, 255, 255, 0.04)',
    color: '#d4d4d4',
    font: 'inherit',
    cursor: 'pointer',
  },
  '.cm-continuation-button:hover': {
    background: 'rgba(255, 255, 255, 0.1)',
  },
});

// ─── 快捷键 ──────────────────────────────────────────────────────────────────

export type ContinuationKeyCommand = 'request' | 'next';

type KeyLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing'
>;

/**
 * ⌥/Alt + \ 与 ⌥/Alt + ] 按物理键位匹配。
 * macOS 上 Option 组合键会输出字符（US 布局 ⌥\ = «、⌥] = ‘），而 CodeMirror keymap 对
 * 「仅 Alt」的组合在 macOS 上不会回退到 keyCode，`Alt-\\` 永远不会命中，所以这里看 event.code。
 */
export function continuationKeyCommand(event: KeyLike): ContinuationKeyCommand | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) {
    return null;
  }
  if (event.code === 'Backslash' || event.key === '\\') return 'request';
  if (event.code === 'BracketRight' || event.key === ']') return 'next';
  return null;
}

export function continuationExtension(getContext: GetAssistContext): Extension {
  return [
    continuationField,
    createController(getContext),
    continuationTheme,
    Prec.highest(
      EditorView.domEventHandlers({
        keydown(event, view) {
          const command = continuationKeyCommand(event);
          if (!command) return false;
          const handled =
            command === 'request'
              ? requestContinuation(view, { mode: 'ghost' })
              : nextContinuation(view);
          // 未处理（例如没有续写可换）时放行，macOS 上 ⌥] 仍可输入「‘」
          if (!handled) return false;
          event.preventDefault();
          return true;
        },
      })
    ),
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: acceptContinuation },
        { key: 'Escape', run: dismissContinuation },
      ])
    ),
  ];
}
