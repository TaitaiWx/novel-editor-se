import { describe, expect, it } from 'vitest';
import { applyRuntimeStartupFailure } from '../../src/main/runtime-copy-state';
import type { RuntimeCopyBootState } from '../../src/main/update-types';

function createBaseState(): RuntimeCopyBootState {
  return {
    schemaVersion: 1,
    launcherVersion: '1.0.0',
    channel: 'beta',
    stableCopy: 'a',
    pendingCopy: 'b',
    currentCopy: 'b',
    lastKnownGoodVersion: '1.0.0',
    lastError: null,
    copies: {
      a: {
        copyName: 'a',
        version: '1.0.0',
        runtimeApiVersion: 1,
        bundleHash: null,
        bundleSize: null,
        source: 'embedded',
        preparedAt: '2026-04-04T00:00:00.000Z',
        lastHealthyAt: '2026-04-04T00:00:00.000Z',
        failedLaunches: 0,
      },
      b: {
        copyName: 'b',
        version: '1.1.0-beta.21',
        runtimeApiVersion: 1,
        bundleHash: 'hash-b',
        bundleSize: 1024,
        source: 'downloaded',
        preparedAt: '2026-04-04T00:10:00.000Z',
        lastHealthyAt: null,
        failedLaunches: 0,
      },
    },
    bootSession: {
      copyName: 'b',
      version: '1.1.0-beta.21',
      startedAt: '2026-04-04T00:11:00.000Z',
      healthyAt: null,
      gracefulExitRequestedAt: null,
    },
  };
}

describe('applyRuntimeStartupFailure', () => {
  it('会在 pending 运行副本失败时立刻切回稳定运行副本', () => {
    const state = createBaseState();
    const resolution = applyRuntimeStartupFailure(state, {
      failedCopy: 'b',
      reason: '渲染进程崩溃',
    });

    expect(resolution.shouldRelaunch).toBe(true);
    expect(resolution.fallbackCopy).toBe('a');
    expect(resolution.nextState.pendingCopy).toBe(null);
    expect(resolution.nextState.currentCopy).toBe('a');
    expect(resolution.nextState.stableCopy).toBe('a');
    expect(resolution.nextState.copies.b.failedLaunches).toBe(1);
  });

  it('可以在阈值未到时只累计失败次数而不立即重启', () => {
    const state = createBaseState();
    const resolution = applyRuntimeStartupFailure(state, {
      failedCopy: 'b',
      reason: '主窗口加载失败',
      maxPendingCopyBootFailures: 2,
    });

    expect(resolution.shouldRelaunch).toBe(false);
    expect(resolution.fallbackCopy).toBe(null);
    expect(resolution.nextState.pendingCopy).toBe('b');
    expect(resolution.nextState.currentCopy).toBe('b');
    expect(resolution.nextState.copies.b.failedLaunches).toBe(1);
  });

  it('稳定运行副本失败时会切到另一个健康运行副本', () => {
    const state = createBaseState();
    state.pendingCopy = null;
    state.currentCopy = 'a';
    state.stableCopy = 'a';
    state.copies.b.lastHealthyAt = '2026-04-04T00:05:00.000Z';
    state.copies.b.version = '1.0.9';
    state.bootSession = {
      copyName: 'a',
      version: '1.0.0',
      startedAt: '2026-04-04T00:12:00.000Z',
      healthyAt: null,
      gracefulExitRequestedAt: null,
    };

    const resolution = applyRuntimeStartupFailure(state, {
      failedCopy: 'a',
      reason: '运行时模块导入失败',
    });

    expect(resolution.shouldRelaunch).toBe(true);
    expect(resolution.fallbackCopy).toBe('b');
    expect(resolution.nextState.currentCopy).toBe('b');
    expect(resolution.nextState.stableCopy).toBe('b');
    expect(resolution.nextState.lastKnownGoodVersion).toBe('1.0.9');
  });

  it('没有健康运行副本时不会进入死循环重启', () => {
    const state = createBaseState();
    state.pendingCopy = null;
    state.currentCopy = 'a';
    state.stableCopy = 'a';
    state.copies.a.lastHealthyAt = null;
    state.copies.b.lastHealthyAt = null;
    state.bootSession = {
      copyName: 'a',
      version: '1.0.0',
      startedAt: '2026-04-04T00:12:00.000Z',
      healthyAt: null,
      gracefulExitRequestedAt: null,
    };

    const resolution = applyRuntimeStartupFailure(state, {
      failedCopy: 'a',
      reason: '主进程启动异常',
    });

    expect(resolution.shouldRelaunch).toBe(false);
    expect(resolution.fallbackCopy).toBe(null);
    expect(resolution.nextState.currentCopy).toBe('a');
    expect(resolution.nextState.lastError).toContain('没有可用的健康运行副本');
  });
});
