import type { RuntimeCopyBootState, RuntimeCopyName } from './update-types';

export interface RuntimeStartupFailureResolution {
  nextState: RuntimeCopyBootState;
  failedCopy: RuntimeCopyName;
  fallbackCopy: RuntimeCopyName | null;
  shouldRelaunch: boolean;
  message: string;
}

function cloneBootState(state: RuntimeCopyBootState): RuntimeCopyBootState {
  return {
    ...state,
    copies: {
      a: { ...state.copies.a },
      b: { ...state.copies.b },
    },
    bootSession: state.bootSession ? { ...state.bootSession } : null,
  };
}

function isHealthyCopy(
  state: RuntimeCopyBootState,
  copyName: RuntimeCopyName | null | undefined,
  failedCopy: RuntimeCopyName
) {
  if (!copyName || copyName === failedCopy) {
    return false;
  }

  const record = state.copies[copyName];
  return Boolean(record.version && record.lastHealthyAt);
}

export function pickHealthyRecoveryCopy(
  state: RuntimeCopyBootState,
  failedCopy: RuntimeCopyName
): RuntimeCopyName | null {
  if (isHealthyCopy(state, state.stableCopy, failedCopy)) {
    return state.stableCopy!;
  }

  const fallbackCandidates: RuntimeCopyName[] = failedCopy === 'a' ? ['b'] : ['a'];
  for (const candidate of fallbackCandidates) {
    if (isHealthyCopy(state, candidate, failedCopy)) {
      return candidate;
    }
  }

  return null;
}

export function applyRuntimeStartupFailure(
  state: RuntimeCopyBootState,
  options: {
    failedCopy: RuntimeCopyName;
    reason: string;
    maxPendingCopyBootFailures?: number;
  }
): RuntimeStartupFailureResolution {
  const nextState = cloneBootState(state);
  const failedCopy = options.failedCopy;
  const maxPendingCopyBootFailures = options.maxPendingCopyBootFailures ?? 1;
  const failedRecord = nextState.copies[failedCopy];
  failedRecord.failedLaunches += 1;
  nextState.bootSession = null;

  const isPendingCopyFailure = nextState.pendingCopy === failedCopy;
  const failedVersion = failedRecord.version ?? '未知版本';

  if (isPendingCopyFailure && failedRecord.failedLaunches < maxPendingCopyBootFailures) {
    const message =
      `新版本 ${failedVersion} 启动异常，已记录失败次数 ` +
      `${failedRecord.failedLaunches}/${maxPendingCopyBootFailures}：${options.reason}`;
    nextState.lastError = message;
    return {
      nextState,
      failedCopy,
      fallbackCopy: null,
      shouldRelaunch: false,
      message,
    };
  }

  if (isPendingCopyFailure) {
    nextState.pendingCopy = null;
  }

  const fallbackCopy = pickHealthyRecoveryCopy(nextState, failedCopy);
  if (fallbackCopy) {
    nextState.currentCopy = fallbackCopy;
    nextState.stableCopy = fallbackCopy;
    nextState.lastKnownGoodVersion = nextState.copies[fallbackCopy].version;
    const message =
      `运行副本 ${failedCopy.toUpperCase()} 的版本 ${failedVersion} 启动失败，` +
      `已切回运行副本 ${fallbackCopy.toUpperCase()} (${nextState.copies[fallbackCopy].version ?? '未知版本'})：${options.reason}`;
    nextState.lastError = message;
    return {
      nextState,
      failedCopy,
      fallbackCopy,
      shouldRelaunch: true,
      message,
    };
  }

  nextState.currentCopy = failedCopy;
  const message = `版本 ${failedVersion} 启动失败，且没有可用的健康运行副本：${options.reason}`;
  nextState.lastError = message;
  return {
    nextState,
    failedCopy,
    fallbackCopy: null,
    shouldRelaunch: false,
    message,
  };
}
