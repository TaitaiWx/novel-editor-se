import { describe, expect, it } from 'vitest';
import {
  IDLE_CONTINUATION,
  MAX_CONTINUATION_VARIANTS,
  canAcceptContinuation,
  currentContinuationText,
  planNextVariant,
  reduceContinuation,
  type ContinuationAction,
  type ContinuationState,
} from '@/render/components/TextEditor/assist/continuation-state';

const OPTIONS = { length: 'sentence' as const, direction: 'continue', followOutline: true };

function run(actions: ContinuationAction[], from: ContinuationState = IDLE_CONTINUATION) {
  return actions.reduce(reduceContinuation, from);
}

const request = (requestId = 1): ContinuationAction => ({
  type: 'request',
  requestId,
  anchor: 5,
  mode: 'ghost',
  options: OPTIONS,
});

describe('continuation state machine', () => {
  it('request → chunk → done → 可采纳', () => {
    let state = run([request()]);
    expect(state.phase).toBe('loading');
    expect(canAcceptContinuation(state)).toBe(false);
    state = run([{ type: 'chunk', requestId: 1, text: '雾气' }], state);
    expect(state.phase).toBe('streaming');
    expect(canAcceptContinuation(state)).toBe(true);
    state = run(
      [
        { type: 'chunk', requestId: 1, text: '雾气翻涌。' },
        { type: 'done', requestId: 1 },
      ],
      state
    );
    expect(state.phase).toBe('ready');
    expect(currentContinuationText(state)).toBe('雾气翻涌。');
    expect(run([{ type: 'clear' }], state)).toEqual(IDLE_CONTINUATION);
  });

  it('过期请求的片段 / 完成 / 错误被忽略', () => {
    const state = run([request(1), request(2), { type: 'chunk', requestId: 1, text: '旧' }]);
    expect(state.requestId).toBe(2);
    expect(currentContinuationText(state)).toBe('');
    expect(run([{ type: 'done', requestId: 1 }], state).phase).toBe('loading');
    expect(
      run(
        [{ type: 'error', requestId: 1, error: { kind: 'auth', message: 'x', retryable: false } }],
        state
      ).phase
    ).toBe('loading');
  });

  it('完成但没有内容 → 错误；错误后 next 替换失败版本重新请求', () => {
    const empty = run([request(), { type: 'done', requestId: 1 }]);
    expect(empty.phase).toBe('error');
    expect(empty.error?.kind).toBe('invalid-response');
    const retried = run([{ type: 'next', requestId: 2, replace: true }], empty);
    expect(retried).toMatchObject({ phase: 'loading', requestId: 2, variants: [''], index: 0 });
  });

  it('换一个：保留已有版本，满 3 个后在版本间轮换', () => {
    let state = run([
      request(1),
      { type: 'chunk', requestId: 1, text: 'A' },
      { type: 'done', requestId: 1 },
    ]);
    expect(planNextVariant(state)).toBe('request');
    for (let id = 2; id <= MAX_CONTINUATION_VARIANTS; id += 1) {
      state = run(
        [
          { type: 'next', requestId: id },
          { type: 'chunk', requestId: id, text: String.fromCharCode(64 + id) },
          { type: 'done', requestId: id },
        ],
        state
      );
    }
    expect(state.variants).toEqual(['A', 'B', 'C']);
    expect(state.index).toBe(2);
    expect(planNextVariant(state)).toBe('cycle');
    state = run([{ type: 'cycle' }], state);
    expect(currentContinuationText(state)).toBe('A');
  });

  it('流式中换一个：丢弃未完成的版本', () => {
    const state = run([
      request(1),
      { type: 'chunk', requestId: 1, text: '半句' },
      { type: 'next', requestId: 2, replace: true },
    ]);
    expect(state.variants).toEqual(['']);
    expect(planNextVariant(IDLE_CONTINUATION)).toBe('none');
  });

  it('上下文只记录到当前请求', () => {
    const context = { budget: 10, usedTokens: 5, providerLabel: 'Grok', sections: [] };
    const state = run([request(1), { type: 'context', requestId: 1, context }]);
    expect(state.context).toBe(context);
    expect(run([{ type: 'context', requestId: 9, context }], IDLE_CONTINUATION)).toBe(
      IDLE_CONTINUATION
    );
  });
});
