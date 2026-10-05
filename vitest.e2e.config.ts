import { defineConfig } from 'vitest/config';

// GUI E2E：启动真实 Electron 应用并通过 CDP 驱动（见 apps/pc/e2e）。
// 与单元测试分开配置，`pnpm test` 不会收集 *.e2e.ts。
export default defineConfig({
  test: {
    environment: 'node',
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
