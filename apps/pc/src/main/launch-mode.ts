import { app } from 'electron';
import { join } from 'path';
import { tmpdir } from 'os';

/** 当前是否为打包产物启动烟雾测试 */
export function isSmokeTestMode(): boolean {
  return process.argv.includes('--smoke-test') || process.env.NOVEL_EDITOR_SMOKE_TEST === '1';
}

/**
 * 当前是否为 GUI E2E 测试（apps/pc/e2e）。
 * 复用烟雾测试的 userData 隔离，但不会在渲染进程就绪后自动退出，由测试进程负责关闭应用
 */
export function isE2ETestMode(): boolean {
  return process.env.NOVEL_EDITOR_E2E === '1';
}

/** 是否禁用自动更新 */
export function isAutoUpdaterDisabled(): boolean {
  return process.env.NOVEL_EDITOR_DISABLE_AUTO_UPDATER === '1';
}

/** 为烟雾测试隔离 userData，避免污染真实用户数据 */
export function applySmokeTestPaths(): void {
  if (!isSmokeTestMode() && !isE2ETestMode()) {
    return;
  }

  const explicitPath = process.env.NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR;
  const smokeUserDataPath =
    explicitPath && explicitPath.trim().length > 0
      ? explicitPath
      : join(tmpdir(), 'novel-editor-smoke-test');

  app.setPath('userData', smokeUserDataPath);
  // 示例数据会拷贝到「文稿/Novel Editor」，测试时同样隔离，避免写入真实文稿目录
  app.setPath('documents', join(smokeUserDataPath, 'documents'));
  // 「上传日志」兜底会把日志包保存到「下载」目录，测试时同样隔离，避免写入真实下载目录
  app.setPath('downloads', join(smokeUserDataPath, 'downloads'));
}
