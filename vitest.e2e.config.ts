import { defineConfig } from 'vitest/config';
import { buildTmpEnv } from './vitest.shared';

// GUI E2E：启动真实 Electron 应用并通过 CDP 驱动（见 apps/pc/e2e）。
// 与单元测试分开配置，`pnpm test:ut` 不会收集 *.e2e.ts。
// globalSetup 负责清理上次产物并通过 Vite API 构建应用（产物最新时自动跳过）。
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./vitest.e2e.global-setup.ts'],
    // 临时目录统一落在 novel-editor-tests/e2e 下（Electron 子进程继承该环境变量）
    env: buildTmpEnv('e2e'),
    include: ['apps/pc/e2e/**/*.e2e.ts'],
    // 每个文件独占一个 Electron 实例，串行执行避免窗口 / 单实例锁互相干扰
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 90_000,
    teardownTimeout: 30_000,
    reporters: ['verbose'],
  },
});
