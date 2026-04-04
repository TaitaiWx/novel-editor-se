import { app } from 'electron';
import { join } from 'path';
import { tmpdir } from 'os';

/** 当前是否为打包产物启动烟雾测试 */
export function isSmokeTestMode(): boolean {
  return process.argv.includes('--smoke-test') || process.env.NOVEL_EDITOR_SMOKE_TEST === '1';
}

/** 是否禁用自动更新 */
export function isAutoUpdaterDisabled(): boolean {
  return process.env.NOVEL_EDITOR_DISABLE_AUTO_UPDATER === '1';
}

/** 为烟雾测试隔离 userData，避免污染真实用户数据 */
export function applySmokeTestPaths(): void {
  if (!isSmokeTestMode()) {
    return;
  }

  const explicitPath = process.env.NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR;
  const smokeUserDataPath =
    explicitPath && explicitPath.trim().length > 0
      ? explicitPath
      : join(tmpdir(), 'novel-editor-smoke-test');

  app.setPath('userData', smokeUserDataPath);
}
