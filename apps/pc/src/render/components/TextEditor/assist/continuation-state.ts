/**
 * 续写状态机（纯函数，不依赖 CodeMirror）
 *
 * idle ──request──▶ loading ──chunk──▶ streaming ──done──▶ ready
 *                      │                   │                 │
 *                      └──────error────────┴──▶ error        │
 * 任意非 idle 状态：clear（采纳 / 放弃 / 用户在别处输入）→ idle
 * ready / error：next（⌥]）→ 新版本 loading，或在已有版本间轮换
 *
 * 每次请求带 requestId，过期请求的片段 / 完成 / 错误一律忽略。
 */
import type { SerializedAIError } from '@/shared/ai';
import type { ContinuationContextSummary, ContinuationMode, ContinuationOptions } from './types';

export type ContinuationPhase = 'idle' | 'loading' | 'streaming' | 'ready' | 'error';

/** 最多保留的版本数；达到后 ⌥] 在已有版本间轮换 */
export const MAX_CONTINUATION_VARIANTS = 3;

export interface ContinuationState {
  phase: ContinuationPhase;
  mode: ContinuationMode;
  /** 续写插入点（文档偏移，随文档变化映射） */
  anchor: number;
  requestId: number;
  variants: string[];
  index: number;
  error: SerializedAIError | null;
  context: ContinuationContextSummary | null;
  options: ContinuationOptions | null;
}

export type ContinuationAction =
  | {
      type: 'request';
      requestId: number;
      anchor: number;
      mode: ContinuationMode;
      options: ContinuationOptions;
    }
  | { type: 'context'; requestId: number; context: ContinuationContextSummary }
  | { type: 'chunk'; requestId: number; text: string }
  | { type: 'done'; requestId: number }
  | { type: 'error'; requestId: number; error: SerializedAIError }
  /** 新版本（⌥] / 重试）：保留已有版本，追加一个空版本重新请求 */
  | { type: 'next'; requestId: number; replace?: boolean }
  /** 在已有版本间轮换 */
  | { type: 'cycle' }
  | { type: 'clear' };

export const IDLE_CONTINUATION: ContinuationState = {
  phase: 'idle',
  mode: 'ghost',
  anchor: 0,
  requestId: 0,
  variants: [],
  index: 0,
  error: null,
  context: null,
  options: null,
};

export function isContinuationActive(state: ContinuationState): boolean {
  return state.phase !== 'idle';
}

/** 当前显示的续写文本 */
export function currentContinuationText(state: ContinuationState): string {
  return state.variants[state.index] ?? '';
}

/** 能否采纳：有文本，且不在等待首个片段 */
export function canAcceptContinuation(state: ContinuationState): boolean {
  return (
    (state.phase === 'streaming' || state.phase === 'ready') &&
    currentContinuationText(state).trim().length > 0
  );
}

/** ⌥] 的处理方式：新请求 / 轮换 / 忽略 */
export function planNextVariant(state: ContinuationState): 'request' | 'cycle' | 'none' {
  if (state.phase === 'idle' || state.phase === 'loading') return 'none';
  if (state.phase === 'streaming') return 'request';
  const filled = state.variants.filter((text) => text.trim()).length;
  if (state.phase === 'ready' && filled >= MAX_CONTINUATION_VARIANTS) return 'cycle';
  return 'request';
}

export function reduceContinuation(
  state: ContinuationState,
  action: ContinuationAction
): ContinuationState {
  switch (action.type) {
    case 'request':
      return {
        phase: 'loading',
        mode: action.mode,
        anchor: action.anchor,
        requestId: action.requestId,
        variants: [''],
        index: 0,
        error: null,
        context: null,
        options: action.options,
      };
    case 'context':
      if (action.requestId !== state.requestId || state.phase === 'idle') return state;
      return { ...state, context: action.context };
    case 'chunk': {
      if (action.requestId !== state.requestId) return state;
      if (state.phase !== 'loading' && state.phase !== 'streaming') return state;
      const variants = state.variants.slice();
      variants[state.index] = action.text;
      return { ...state, phase: 'streaming', variants };
    }
    case 'done':
      if (action.requestId !== state.requestId) return state;
      if (state.phase !== 'loading' && state.phase !== 'streaming') return state;
      if (!currentContinuationText(state).trim()) {
        return {
          ...state,
          phase: 'error',
          error: { kind: 'invalid-response', message: 'AI 没有返回内容', retryable: true },
        };
      }
      return { ...state, phase: 'ready' };
    case 'error':
      if (action.requestId !== state.requestId || state.phase === 'idle') return state;
      return { ...state, phase: 'error', error: action.error };
    case 'next': {
      if (state.phase === 'idle') return state;
      // 丢弃空版本（失败或刚开始就换），保留已有的完整版本
      const kept = state.variants.filter(
        (text, index) => text.trim() && !(action.replace && index === state.index)
      );
      const variants = [...kept, ''].slice(-MAX_CONTINUATION_VARIANTS);
      return {
        ...state,
        phase: 'loading',
        requestId: action.requestId,
        variants,
        index: variants.length - 1,
        error: null,
      };
    }
    case 'cycle': {
      if (state.phase !== 'ready' || state.variants.length < 2) return state;
      return { ...state, index: (state.index + 1) % state.variants.length };
    }
    case 'clear':
      return state.phase === 'idle' ? state : { ...IDLE_CONTINUATION };
    default:
      return state;
  }
}
