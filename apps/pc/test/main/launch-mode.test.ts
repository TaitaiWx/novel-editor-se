import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const setPath = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({ app: { setPath } }));

import {
  applySmokeTestPaths,
  isAutoUpdaterDisabled,
  isE2ETestMode,
  isSmokeTestMode,
} from '../../src/main/launch-mode';

describe('launch-mode', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    setPath.mockReset();
    process.argv = ['node', 'app'];
    vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST', '');
    vi.stubEnv('NOVEL_EDITOR_DISABLE_AUTO_UPDATER', '');
    vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR', '');
    vi.stubEnv('NOVEL_EDITOR_E2E', '');
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
  });

  describe('isSmokeTestMode', () => {
    it('默认关闭', () => {
      expect(isSmokeTestMode()).toBe(false);
    });

    it('--smoke-test 参数开启', () => {
      process.argv = ['node', 'app', '--smoke-test'];
      expect(isSmokeTestMode()).toBe(true);
    });

    it('环境变量为 1 时开启，其它值不开启', () => {
      vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST', '1');
      expect(isSmokeTestMode()).toBe(true);
      vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST', 'true');
      expect(isSmokeTestMode()).toBe(false);
    });
  });

  describe('isE2ETestMode', () => {
    it('仅在环境变量为 1 时开启', () => {
      expect(isE2ETestMode()).toBe(false);
      vi.stubEnv('NOVEL_EDITOR_E2E', '1');
      expect(isE2ETestMode()).toBe(true);
    });
  });

  describe('isAutoUpdaterDisabled', () => {
    it('仅在环境变量为 1 时禁用', () => {
      expect(isAutoUpdaterDisabled()).toBe(false);
      vi.stubEnv('NOVEL_EDITOR_DISABLE_AUTO_UPDATER', '1');
      expect(isAutoUpdaterDisabled()).toBe(true);
      vi.stubEnv('NOVEL_EDITOR_DISABLE_AUTO_UPDATER', '0');
      expect(isAutoUpdaterDisabled()).toBe(false);
    });
  });

  describe('applySmokeTestPaths', () => {
    it('非烟雾测试模式不修改 userData', () => {
      applySmokeTestPaths();
      expect(setPath).not.toHaveBeenCalled();
    });

    it('未指定目录时使用系统临时目录', () => {
      process.argv = ['node', 'app', '--smoke-test'];
      applySmokeTestPaths();
      expect(setPath).toHaveBeenCalledWith('userData', join(tmpdir(), 'novel-editor-smoke-test'));
    });

    it('空白的显式目录被忽略', () => {
      process.argv = ['node', 'app', '--smoke-test'];
      vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR', '   ');
      applySmokeTestPaths();
      expect(setPath).toHaveBeenCalledWith('userData', join(tmpdir(), 'novel-editor-smoke-test'));
    });

    it('E2E 模式同样隔离 userData', () => {
      vi.stubEnv('NOVEL_EDITOR_E2E', '1');
      vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR', '/tmp/custom-e2e');
      applySmokeTestPaths();
      expect(setPath).toHaveBeenCalledWith('userData', '/tmp/custom-e2e');
    });

    it('使用显式指定的目录', () => {
      vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST', '1');
      vi.stubEnv('NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR', '/tmp/custom-smoke');
      applySmokeTestPaths();
      expect(setPath).toHaveBeenCalledWith('userData', '/tmp/custom-smoke');
    });
  });
});
