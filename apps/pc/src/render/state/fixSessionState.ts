import type { InlineDiffRange } from '../components/TextEditor';
import type { PendingApplyItem } from './aiSessionSnapshot';

export interface FixDiffState {
  original: string;
  modified: string;
  originalLabel: string;
  modifiedLabel: string;
}

export type FixLifecyclePhase =
  | 'idle'
  | 'preview-ready'
  | 'awaiting-confirm'
  | 'applying'
  | 'applied'
  | 'failed';

export interface FixSessionState {
  phase: FixLifecyclePhase;
  inlineDiff: InlineDiffRange | null;
  diffState: FixDiffState | null;
  pendingApplyQueue: PendingApplyItem[];
  lastError: string | null;
}

export type FixSessionCommand =
  | {
      type: 'FIX_DIFF_VIEW_OPEN';
      diffState: FixDiffState;
    }
  | {
      type: 'FIX_PREVIEW_READY';
      inlineDiff: InlineDiffRange;
    }
  | {
      type: 'FIX_CONFIRM_ENQUEUED';
      diffState: FixDiffState;
      item: PendingApplyItem;
    }
  | {
      type: 'FIX_APPLY_STARTED';
    }
  | {
      type: 'FIX_APPLY_SUCCEEDED';
      keepPreview?: boolean;
    }
  | {
      type: 'FIX_APPLY_FAILED';
      error: string;
    }
  | {
      type: 'FIX_CLEAR';
    }
  | {
      type: 'FIX_SESSION_HYDRATED';
      inlineDiff: InlineDiffRange | null;
      pendingApplyQueue: PendingApplyItem[];
    };

export const initialFixSessionState: FixSessionState = {
  phase: 'idle',
  inlineDiff: null,
  diffState: null,
  pendingApplyQueue: [],
  lastError: null,
};

export function reduceFixSession(
  state: FixSessionState,
  command: FixSessionCommand
): FixSessionState {
  switch (command.type) {
    case 'FIX_DIFF_VIEW_OPEN': {
      return {
        ...state,
        diffState: command.diffState,
        lastError: null,
      };
    }
    case 'FIX_SESSION_HYDRATED': {
      return {
        ...state,
        // inlineDiff 是编辑器级状态——装饰位置与当前文档版本强绑定，
        // BroadcastChannel / SQLite 携带的 inlineDiff 在文档变更后一定失效。
        // 永远保留本地值，不接受外部覆盖。
        pendingApplyQueue: command.pendingApplyQueue,
      };
    }
    case 'FIX_PREVIEW_READY': {
      return {
        ...state,
        phase: 'preview-ready',
        inlineDiff: command.inlineDiff,
        lastError: null,
      };
    }
    case 'FIX_CONFIRM_ENQUEUED': {
      return {
        ...state,
        phase: 'awaiting-confirm',
        diffState: command.diffState,
        pendingApplyQueue: [...state.pendingApplyQueue, command.item],
        lastError: null,
      };
    }
    case 'FIX_APPLY_STARTED': {
      return {
        ...state,
        phase: 'applying',
        lastError: null,
      };
    }
    case 'FIX_APPLY_SUCCEEDED': {
      const [, ...rest] = state.pendingApplyQueue;
      return {
        ...state,
        phase: 'applied',
        pendingApplyQueue: rest,
        diffState: rest.length > 0 ? state.diffState : null,
        inlineDiff: command.keepPreview ? state.inlineDiff : null,
        lastError: null,
      };
    }
    case 'FIX_APPLY_FAILED': {
      return {
        ...state,
        phase: 'failed',
        lastError: command.error,
      };
    }
    case 'FIX_CLEAR': {
      return {
        ...state,
        phase: 'idle',
        inlineDiff: null,
        diffState: null,
        pendingApplyQueue: [],
        lastError: null,
      };
    }
    default:
      return state;
  }
}

export const fixSessionSelectors = {
  inlineDiff: (state: FixSessionState) => state.inlineDiff,
  diffState: (state: FixSessionState) => state.diffState,
  pendingApplyQueue: (state: FixSessionState) => state.pendingApplyQueue,
  canAccept: (state: FixSessionState) => state.pendingApplyQueue.length > 0,
};
