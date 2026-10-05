/**
 * UT / E2E 共享的测试基础设施配置
 *
 * - 所有测试产生的临时文件统一落在 TEST_TMP_ROOT 下（通过 TMPDIR/TEMP/TMP 注入，
 *   用例里的 os.tmpdir() / mkdtemp 无需改动即可生效，Electron 子进程同样继承）
 * - 每次运行前由 globalSetup 自动清理上一次的临时目录与 E2E 截图日志；
 *   覆盖率报告由 Vitest coverage.clean 自动清空
 */
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = __dirname;

/** 测试临时目录根：<系统临时目录>/novel-editor-tests/<套件> */
export function getTestTmpRoot(suite: 'ut' | 'e2e'): string {
  return path.join(os.tmpdir(), 'novel-editor-tests', suite);
}

/** 让子进程与 os.tmpdir() 都指向测试临时目录 */
export function buildTmpEnv(suite: 'ut' | 'e2e'): Record<string, string> {
  const root = getTestTmpRoot(suite);
  return { TMPDIR: root, TEMP: root, TMP: root };
}

/**
 * 运行前清理的产物目录
 * 覆盖率目录（coverage/）由 Vitest 的 coverage.clean 在启动时自动清空，
 * 且它早于 globalSetup 创建，这里不能再删，否则会删掉 Vitest 的工作目录
 */
export const UT_ARTIFACT_DIRS: string[] = [];
export const E2E_ARTIFACT_DIRS = [path.join(REPO_ROOT, 'apps/pc/e2e/.artifacts')];

/** 删除上一次运行留下的临时目录与产物，并重建临时目录根 */
export function cleanTestArtifacts(suite: 'ut' | 'e2e', artifactDirs: string[]): void {
  const tmpRoot = getTestTmpRoot(suite);
  for (const dir of [tmpRoot, ...artifactDirs]) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
  mkdirSync(tmpRoot, { recursive: true });
}
